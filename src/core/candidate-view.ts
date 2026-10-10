import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { readArtifact, type Artifact } from '../journal.js';
import type { SessionTarget } from '../shared/protocol.js';
import type { CoreCandidateView } from '../shared/core-candidate-view.js';
import { CoreCandidates, scanCoreSource } from './candidates.js';
import { CoreBuilds, type CoreBuildResult } from './builds.js';
import { CoreValidations, type CoreValidationResult } from './validations.js';

/** Reading a candidate must never perform build-plan admission, start a process or write a Journal. */
export async function coreCandidateView(candidates: CoreCandidates, target: SessionTarget): Promise<CoreCandidateView> {
  if (!target.coreCandidate) throw Error('核心目标没有候选基线');
  const inspected = await candidates.inspect(target.coreCandidate.id), candidate = inspected.candidate;
  if (candidate.directory !== target.root || candidate.source.revision !== target.coreCandidate.sourceRevision) throw Error('核心候选与会话目标不匹配');
  const snapshot = await scanCoreSource(candidate.directory);
  if (snapshot.revision !== inspected.current.revision) throw Error('读取期间源码已变化，请重新读取');
  const before = new Map(candidate.source.files.map(file => [file.path, file])), after = new Map(snapshot.files.map(file => [file.path, file]));
  let remainingText = 256 * 1024;
  const files: CoreCandidateView['files'] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(path), b = after.get(path);
    if (a?.sha256 === b?.sha256 && a?.executable === b?.executable) continue;
    const content = snapshot.contents.get(path), binary = content?.includes(0) ?? false;
    const limit = Math.min(4000, remainingText), text = content && !binary ? content.subarray(0, limit).toString('utf8') : undefined;
    remainingText -= content && !binary ? Math.min(limit, content.length) : 0;
    let baselineText: string | undefined, beforeError: string | undefined, baselineTruncated = false;
    if (a) {
      const ref = candidate.sourceArtifacts?.[path];
      if (!ref) beforeError = '该候选未保留基线正文；仅有可信摘要，不能从现有源目录重建。';
      else try {
        if (ref.sha256 !== a.sha256 || ref.bytes !== a.bytes) throw Error('基线附件与登记摘要不一致');
        const bytes = await readArtifact(await realpath(join(candidates.home, 'core-candidates', 'journal')), ref);
        if (bytes.includes(0)) beforeError = '基线为二进制文件；展示摘要与字节数。';
        else { const keep = Math.min(4000, remainingText); baselineText = bytes.subarray(0, keep).toString('utf8'); baselineTruncated = bytes.length > keep; remainingText -= Math.min(bytes.length, keep); }
      } catch (error) { beforeError = String(error); }
    }
    files.push({ path, change: !a ? 'added' : !b ? 'removed' : 'modified', beforeHash: a?.sha256, afterHash: b?.sha256, beforeBytes: a?.bytes, afterBytes: b?.bytes,
      before: baselineText, beforeError, after: text, binary, truncated: baselineTruncated || !!content && !binary && content.length > limit });
  }
  const builds = new CoreBuilds(candidates), validations = new CoreValidations(builds);
  const histories = await Promise.allSettled([builds.records(), validations.records()]);
  const result: CoreCandidateView = { id: candidate.id, directory: candidate.directory, sourceRoot: candidate.source.root, baselineRevision: candidate.source.revision,
    currentRevision: snapshot.revision, target, hostMatches: inspected.hostMatches, preparedAt: candidate.preparedAt,
    packageVersion: inspected.current.packageVersion, lockHash: inspected.current.lockHash, buildCommand: inspected.current.buildCommand,
    files, excluded: snapshot.excluded, historyErrors: [], omittedTasks: 0, tasks: [] };
  let remainingLogs = 256 * 1024;
  for (const [index, history] of histories.entries()) {
    const kind = index === 0 ? 'build' : 'validation', prefix = `core.${kind}`;
    if (history.status === 'rejected') { result.historyErrors.push(`${kind === 'build' ? '构建' : '独立验证'}记录不可读：${String(history.reason)}`); continue; }
    const events = history.value.filter(event => event.candidateId === candidate.id);
    const allIntents = events.filter(event => event.type === `${prefix}.intent`);
    result.omittedTasks += Math.max(0, allIntents.length - 50);
    const intents = allIntents.slice(-50).reverse();
    for (const intent of intents) {
      const input = intent.payload as { commandId: string; buildId: string; validationId?: string; inputHash?: string; artifactRevision?: string; plan?: { sourceRevision: string } };
      const taskId = kind === 'build' ? input.buildId : input.validationId!;
      const taskEvents = events.filter(event => event.validationTaskId === taskId);
      const finished = taskEvents.find(event => event.type === `${prefix}.finished`);
      const terminal = finished?.payload as CoreBuildResult | CoreValidationResult | undefined;
      const output = taskEvents.filter(event => event.type === `${prefix}.output`);
      const logs: CoreCandidateView['tasks'][number]['logs'] = [];
      for (const event of output.slice(0, 100)) {
        if (remainingLogs <= 0) break;
        const payload = event.payload as { channel: string; artifact: Artifact };
        try {
          const bytes = await readArtifact(await realpath(join(candidates.home, kind === 'build' ? 'core-builds' : 'core-validations', 'journal')), payload.artifact);
          const length = Math.min(bytes.length, remainingLogs, 16384);
          logs.push({ at: event.timestamp, channel: payload.channel, text: bytes.subarray(0, length).toString('utf8'), truncated: length < bytes.length });
          remainingLogs -= length;
        } catch (error) { logs.push({ at: event.timestamp, channel: payload.channel, error: `日志附件不可读：${String(error)}` }); }
      }
      result.tasks.push({ id: taskId, commandId: input.commandId, kind, status: terminal?.status ?? 'unconfirmed', startedAt: intent.timestamp, finishedAt: finished?.timestamp,
        sourceRevision: input.plan?.sourceRevision, inputHash: input.inputHash, buildId: input.buildId,
        artifactRevision: terminal && 'artifact' in terminal ? terminal.artifact?.revision : input.artifactRevision,
        error: terminal?.error, checks: terminal && 'checks' in terminal ? terminal.checks : [], logs, omittedLogs: output.length - logs.length });
    }
  }
  result.tasks.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return result;
}
