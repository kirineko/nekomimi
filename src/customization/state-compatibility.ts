/** A schema mismatch is a host execution gate, not an optional SDK diagnostic. */
export class StateCompatibilityError extends Error {
  constructor(scope: 'session' | 'workspace' = 'session') {
    super(`${scope === 'workspace' ? 'Workspace state' : 'State'} schema incompatible; explicit migration required`);
    this.name = 'StateCompatibilityError';
  }
}
