import { homedir } from 'node:os';
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, Journal, readSession } from '../journal.js';
import { hostIdentity } from '../customization/sdk.js';

export interface CoreInstallationIdentity { version: 1; id: string; entry: string }
/** A project or explicit data home must never partition the same installation's writer lease. */
export class CoreInstallation {
  private constructor(readonly identity: CoreInstallationIdentity, readonly directory: string) {}
  static async locate(options: { entry?: string; registry?: string } = {}) {
    const entry = await realpath(options.entry ?? (await hostIdentity()).entry);
    const identity: CoreInstallationIdentity = { version: 1, id: hash(entry), entry };
    return new CoreInstallation(identity, join(options.registry ?? join(homedir(), '.nekomimi', 'installations'), identity.id));
  }
  async read() {
    try { await stat(join(this.directory, 'journal.jsonl')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { identity: this.identity, events: [] }; throw error; }
    const snapshot = await readSession(this.directory);
    if (snapshot.events[0]?.type !== 'core.installation') throw Error('Core installation Journal type mismatch');
    this.check(snapshot.events[0]?.payload);
    return { identity: this.identity, events: snapshot.events };
  }
  private check(value: unknown) {
    if (JSON.stringify(value) !== JSON.stringify(this.identity)) throw Error('Core installation identity mismatch');
  }
  async acquire(secrets: string[] = []) {
    await this.read();
    const journal = await Journal.open(this.directory, { secrets });
    try {
      if (!journal.events.length) await journal.append('core.installation', this.identity);
      if (journal.events[0]?.type !== 'core.installation') throw Error('Core installation Journal type mismatch');
      this.check(journal.events[0]?.payload);
      return journal;
    } catch (error) { await journal.close(); throw error; }
  }
}
