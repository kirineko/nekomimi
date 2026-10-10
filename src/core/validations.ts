import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Journal, id, readSession } from '../journal.js';
import { validId } from '../shared/protocol.js';
import { CoreBuilds } from './builds.js';
import { validateCoreIsolation, type CoreIsolationResult } from './validation.js';

export interface CoreValidationResult extends CoreIsolationResult {
  version: 1; validationId: string; commandId: string; buildId: string; candidateId: string; artifactRevision: string;
}
export class CoreValidations {
  constructor(readonly builds: CoreBuilds) {}
  private get root() { return join(this.builds.candidates.home, 'core-validations'); }
  private get journalPath() { return join(this.root, 'journal'); }
  async records() {
    try { await stat(join(this.journalPath, 'journal.jsonl')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const allowed = new Set((await this.builds.candidates.list()).map(candidate => candidate.id));
    return (await readSession(this.journalPath)).events.filter(event => event.candidateId && allowed.has(event.candidateId));
  }
  async inspect(validationId: string) {
    const record = (await this.records()).find(event => event.type === 'core.validation.finished' && (event.payload as CoreValidationResult).validationId === validationId);
    if (!record) throw Error('Core validation has no durable terminal; it will not restart automatically');
    const result = record.payload as CoreValidationResult;
    const build = await this.builds.inspect(result.buildId);
    const validForCurrent = result.status === 'passed' && build.validForCurrent && build.result.artifact?.revision === result.artifactRevision;
    return { result, validForCurrent, invalidReason: validForCurrent ? undefined : build.invalidReason ?? 'Validation did not pass for the current artifact' };
  }
  async validate(input: { buildId: string; artifactRevision: string; commandId: string; authorize: boolean }, options: { signal?: AbortSignal } = {}): Promise<CoreValidationResult> {
    if (!input || input.authorize !== true) throw Error('Explicit trusted candidate execution authorization required');
    if (!validId(input.commandId) || !validId(input.buildId) || !/^[a-f0-9]{64}$/.test(input.artifactRevision)) throw Error('Validation requires buildId, commandId and confirmed artifactRevision');
    const events = await this.records();
    const previous = events.find(event => event.type === 'core.validation.intent' && (event.payload as CoreValidationResult).commandId === input.commandId);
    if (previous) {
      const prior = previous.payload as CoreValidationResult;
      if (prior.buildId !== input.buildId || prior.artifactRevision !== input.artifactRevision) throw Error('Core validation command conflict');
      const terminal = events.find(event => event.type === 'core.validation.finished' && (event.payload as CoreValidationResult).validationId === prior.validationId);
      return terminal ? terminal.payload as CoreValidationResult : { ...prior, status: 'unknown', error: 'Accepted validation has no durable terminal; it will not restart automatically' };
    }
    const build = await this.builds.inspect(input.buildId);
    if (!build.validForCurrent || build.result.artifact?.revision !== input.artifactRevision) throw Error('Core build changed or did not pass; validate a current artifact');
    options.signal?.throwIfAborted();
    const secrets = Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key)).map(([, value]) => value).filter((value): value is string => !!value);
    const journal = await Journal.open(this.journalPath, { secrets });
    if (journal.events.some(event => event.type === 'core.validation.intent' && (event.payload as CoreValidationResult).commandId === input.commandId)) {
      await journal.close();
      if (!(await this.records()).some(event => event.type === 'core.validation.intent' && (event.payload as CoreValidationResult).commandId === input.commandId)) throw Error('Core validation command belongs to another project');
      return this.validate(input, options);
    }
    const validationId = id(), candidateId = build.result.candidateId;
    let result: CoreValidationResult = { version: 1, validationId, candidateId, buildId: input.buildId, commandId: input.commandId, artifactRevision: input.artifactRevision, status: 'failed', checks: [], ports: [], stage: 'isolated-startup', hostIntegration: 'not_run', applied: false };
    const signal = AbortSignal.any([AbortSignal.timeout(60000), ...(options.signal ? [options.signal] : [])]);
    try {
      await journal.append('core.validation.intent', result, { candidateId, validationTaskId: validationId });
      await mkdir(join(this.root, 'tasks'), { recursive: true, mode: 0o700 });
      result = { ...result, ...await journal.withLinks({ candidateId, validationTaskId: validationId }, () => validateCoreIsolation({ directory: build.result.artifact!.directory, task: join(this.root, 'tasks', validationId), journal, signal, secrets })) };
      if (result.status === 'passed') signal.throwIfAborted();
      if (result.status === 'passed' && !(await this.builds.inspect(input.buildId)).validForCurrent) { result.status = 'failed'; result.error = 'Core build input or artifact changed during validation'; }
    } catch (error) { result.status = signal.aborted ? 'cancelled' : 'failed'; result.error = journal.clean(String(error)); }
    finally { try { await journal.append('core.validation.finished', result, { candidateId, validationTaskId: validationId }); } finally { await journal.close(); } }
    return result;
  }
}
