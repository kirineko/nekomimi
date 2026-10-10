import { ApiError, validId } from '../shared/protocol.js';
export interface CoreSwitchBlocker { kind: string; id?: string; sessionId?: string; target?: string; state?: string }
export interface CoreSwitchReadiness { ready: boolean; token?: string; blockers: CoreSwitchBlocker[] }
/** A synchronous ingress fence closes the await/check/dispatch race. */
export class CoreSwitchGate {
  private fence?: string;
  private pending?: Promise<CoreSwitchReadiness>;
  private sequence = 0;
  private requests = new Map<number, string>();
  blockers(): CoreSwitchBlocker[] {
    return [...(this.fence ? [{ kind: 'switch', id: this.fence }] : []), ...[...this.requests].map(([id, label]) => ({ kind: 'request', id: String(id), state: label }))];
  }
  enter(label: string) {
    if (this.fence) throw new ApiError(409, 'core_switching', '核心切换正在准备，暂不接受新操作');
    const key = ++this.sequence; this.requests.set(key, label);
    let released = false;
    return () => { if (!released) { released = true; this.requests.delete(key); } };
  }
  async prepare(token: string, inspect: () => Promise<CoreSwitchReadiness>): Promise<CoreSwitchReadiness> {
    if (typeof token !== 'string' || !validId(token)) throw new ApiError(400, 'input', '切换门禁 ID 无效');
    if (this.fence === token && this.pending) return this.pending;
    if (this.fence) return { ready: this.fence === token, ...(this.fence === token ? { token } : {}), blockers: this.fence === token ? [] : [{ kind: 'switch', id: this.fence }] };
    if (this.requests.size) return { ready: false, blockers: [...this.requests].map(([id, label]) => ({ kind: 'request', id: String(id), state: label })) };
    this.fence = token;
    const pending = Promise.resolve().then(inspect).then(result => {
      if (!result.ready) this.fence = undefined;
      return result;
    }, error => { this.fence = undefined; throw error; }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }

  release(token: string) {
    if (this.pending) throw new ApiError(409, 'core_switching', '请等待空闲检查结束');
    if (this.fence && this.fence !== token) throw new ApiError(409, 'core_switching', '切换门禁不属于此命令');
    this.fence = undefined;
  }
}
