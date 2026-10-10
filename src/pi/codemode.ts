import {
  CodemodeSandbox, loadQuickJSWasm, MAX_OUTPUT_CHARS, MAX_OUTPUT_ITEMS,
  MAX_STORE_TOTAL_CHARS, MAX_STORE_VALUE_CHARS,
  type CodemodeTool, type CodemodeExecuteOptions, type CodemodeResult,
} from '@earendil-works/pi-codemode';

/** Product limits cannot be raised by model-generated source or execution options. */
export const CODEMODE_LIMITS = Object.freeze({
  version: 1, timeoutMs: 30_000, memoryLimitBytes: 16 * 1024 * 1024,
  sourceBytes: 256 * 1024, outputChars: MAX_OUTPUT_CHARS, outputItems: MAX_OUTPUT_ITEMS,
  storeTotalChars: MAX_STORE_TOTAL_CHARS, storeValueChars: MAX_STORE_VALUE_CHARS,
  childCalls: 128, concurrentCalls: 4, concurrentResourceCalls: 2, cancelGraceMs: 1000,
});
export type ScriptTool = CodemodeTool;
export type ScriptResult = CodemodeResult;

/** Only injected tools cross the VM boundary. Authorization belongs to their host pipeline. */
export class ScriptSandbox {
  private readonly sandbox: CodemodeSandbox;
  constructor(tools: readonly ScriptTool[] = []) {
    this.sandbox = new CodemodeSandbox({
      tools: [...tools], timeoutMs: CODEMODE_LIMITS.timeoutMs,
      memoryLimitBytes: CODEMODE_LIMITS.memoryLimitBytes,
      // Resolve published exports; the dependency owns and ships its worker and WASM.
      workerUrl: new URL(import.meta.resolve('@earendil-works/pi-codemode/worker')),
      wasm: loadQuickJSWasm(),
    });
  }
  async execute(source: string, options: CodemodeExecuteOptions = {}): Promise<ScriptResult> {
    const rejected = (message: string): ScriptResult => ({ok:false,error:{kind:'script',message},output:[],calls:[]});
    if (Buffer.byteLength(source) > CODEMODE_LIMITS.sourceBytes) return rejected('脚本超过源代码字节上限');
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))
      return rejected('脚本执行时限必须为正有限数');
    try {
      if (JSON.stringify(options.store ?? {}).length > CODEMODE_LIMITS.storeTotalChars ||
          Object.values(options.store ?? {}).some(value => (JSON.stringify(value)?.length ?? 0) > CODEMODE_LIMITS.storeValueChars))
        return rejected('脚本状态超过大小上限');
    } catch { return rejected('脚本状态必须可以编码为 JSON'); }
    return this.sandbox.execute(source, {
      ...options, timeoutMs: Math.min(options.timeoutMs ?? CODEMODE_LIMITS.timeoutMs, CODEMODE_LIMITS.timeoutMs),
    });
  }
  close() { return this.sandbox.close(); }
}
