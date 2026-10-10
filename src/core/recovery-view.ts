import { CoreRecovery } from './recovery.js';
import type { CoreInstallation } from './installation.js';
import type { CoreRecoveryView } from '../shared/core-control.js';

/** Read only: no writer lease, signals, reconciliation, candidate load or launch. */
export async function coreRecoveryView(installation: CoreInstallation): Promise<CoreRecoveryView> {
  const observation = await new CoreRecovery(installation).preview();
  const requiresBuild = !installation.identity.entry.endsWith('.js');
  return { ...observation, applied: false, tasksReplayed: false, launcher: requiresBuild ? { requiresBuild: true } : {
    requiresBuild: false, executable: process.execPath, args: [installation.identity.entry, 'core', 'recovery-info'],
  } };
}
