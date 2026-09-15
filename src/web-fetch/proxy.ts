import { execFile } from "node:child_process";

export class FetchPolicyError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export interface ProxyPolicy {
  source: "none" | "explicit" | "environment" | "system";
  httpProxy?: string;
  httpsProxy?: string;
  noProxy: string;
}
export const directPolicy: ProxyPolicy = { source: "none", noProxy: "" };
const invalid = () => new FetchPolicyError("PROXY_CONFIG", "网页代理配置无效；请使用 HTTP(S) 代理地址");
export function proxyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.search || url.hash || url.pathname !== "/") throw invalid();
    decodeURIComponent(url.username); decodeURIComponent(url.password);
    return url.href;
  } catch { throw invalid(); }
}
export function bypassProxy(url: URL, list: string): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return list.toLowerCase().split(/[\s,;]+/).filter(Boolean).some(entry => {
    if (entry === "*") return true;
    if (entry === "<local>") return !host.includes(".") && !host.includes(":");
    let name = entry, entryPort: string | undefined;
    if (entry.startsWith("[")) {
      const match = entry.match(/^\[([^\]]+)\](?::(\d+))?$/);
      if (!match) return false;
      name = match[1]!; entryPort = match[2];
    } else if ((entry.match(/:/g) ?? []).length === 1) {
      const index = entry.lastIndexOf(":"); name = entry.slice(0, index); entryPort = entry.slice(index + 1);
    }
    if (entryPort && entryPort !== port) return false;
    name = name.replace(/^\*?\./, "").replace(/\.$/, "");
    return host === name || (!name.includes(":") && host.endsWith(`.${name}`));
  });
}
export function proxyFor(url: URL, policy: ProxyPolicy): string | undefined {
  if (bypassProxy(url, policy.noProxy)) return undefined;
  return url.protocol === "https:" ? policy.httpsProxy : policy.httpProxy;
}
const unsupported = () => new FetchPolicyError("PROXY_UNSUPPORTED", "系统仅启用了 PAC、自动发现或 SOCKS 代理；请配置 HTTP(S) 代理");
function systemAddress(host: string | undefined, port: string | undefined): string {
  if (!host || !port || !/^\d+$/.test(port) || +port < 1 || +port > 65535 || /[\s/@?#]/.test(host)) throw invalid();
  return proxyUrl(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`);
}
export function parseMacProxy(text: string): ProxyPolicy {
  if (!text.includes("<dictionary>")) throw invalid();
  const field = (name: string) => text.match(new RegExp(`^\\s*${name}\\s*:\\s*(.*?)\\s*$`, "m"))?.[1];
  const httpProxy = field("HTTPEnable") === "1" ? systemAddress(field("HTTPProxy"), field("HTTPPort")) : undefined;
  const httpsProxy = field("HTTPSEnable") === "1" ? systemAddress(field("HTTPSProxy"), field("HTTPSPort")) : undefined;
  if (!httpProxy && !httpsProxy && ["ProxyAutoConfigEnable", "SOCKSEnable"].some(k => field(k) === "1")) throw unsupported();
  const exceptions = text.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/)?.[1] ?? "";
  const noProxy = [...exceptions.matchAll(/^\s*\d+\s*:\s*(.+?)\s*$/gm)].map(m => m[1]!).join(",");
  return { source: httpProxy || httpsProxy ? "system" : "none", httpProxy, httpsProxy, noProxy: noProxy + (field("ExcludeSimpleHostnames") === "1" ? ",<local>" : "") };
}
export function parseWindowsProxy(text: string): ProxyPolicy {
  let value: { ProxyEnable?: number; ProxyServer?: string; ProxyOverride?: string; AutoConfigURL?: string; AutoDetect?: number };
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); if (!value || typeof value !== "object") throw invalid(); } catch { throw invalid(); }
  if (!value.ProxyEnable) {
    if (value.AutoConfigURL) throw unsupported();
    return { ...directPolicy };
  }
  if (typeof value.ProxyServer !== "string" || !value.ProxyServer.trim()) throw invalid();
  const normalize = (v: string) => proxyUrl(v.includes("://") ? v : `http://${v}`);
  let httpProxy: string | undefined, httpsProxy: string | undefined;
  if (!value.ProxyServer.includes("=")) httpProxy = httpsProxy = normalize(value.ProxyServer.trim());
  else {
    const entries = new Map(value.ProxyServer.split(";").map(part => { const i = part.indexOf("="); return [part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()]; }));
    if (entries.get("http")) httpProxy = normalize(entries.get("http")!);
    if (entries.get("https")) httpsProxy = normalize(entries.get("https")!);
    if (!httpProxy && !httpsProxy) throw unsupported();
  }
  return { source: "system", httpProxy, httpsProxy, noProxy: typeof value.ProxyOverride === "string" ? value.ProxyOverride : "" };
}
export async function readSystemProxy(platform: NodeJS.Platform, signal: AbortSignal): Promise<ProxyPolicy> {
  signal.throwIfAborted();
  if (platform !== "darwin" && platform !== "win32") return { ...directPolicy };
  const file = platform === "darwin" ? "/usr/sbin/scutil" : "powershell.exe";
  const args = platform === "darwin" ? ["--proxy"] : ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $p=Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; $p | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL,AutoDetect | ConvertTo-Json -Compress"];
  try {
    const text = await new Promise<string>((resolve, reject) => {
      execFile(file, args, { signal, timeout: 2000, maxBuffer: 65536, encoding: "utf8", windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    signal.throwIfAborted();
    return platform === "darwin" ? parseMacProxy(text) : parseWindowsProxy(text);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FetchPolicyError) throw error;
    throw new FetchPolicyError("PROXY_DETECTION", "无法读取系统代理设置；可设置 NEKOMIMI_WEB_FETCH_PROXY=direct 或显式 HTTP(S) 代理地址");
  }
}
export async function detectProxy(signal: AbortSignal, env: NodeJS.ProcessEnv = process.env, platform = process.platform,
  read: typeof readSystemProxy = readSystemProxy): Promise<ProxyPolicy> {
  signal.throwIfAborted();
  const override = env.NEKOMIMI_WEB_FETCH_PROXY?.trim();
  const get = (name: string) => (env[name.toLowerCase()] ?? env[name])?.trim();
  const noProxy = get("NO_PROXY") ?? "";
  if (override === "direct") return { ...directPolicy, source: "explicit" };
  if (override && override !== "auto") { const address = proxyUrl(override); return { source: "explicit", httpProxy: address, httpsProxy: address, noProxy }; }
  const http = get("HTTP_PROXY"), https = get("HTTPS_PROXY"), all = get("ALL_PROXY");
  if (http || https || all) return {
    source: "environment", noProxy,
    httpProxy: http || all ? proxyUrl((http || all)!) : undefined,
    httpsProxy: https || http || all ? proxyUrl((https || http || all)!) : undefined,
  };
  const policy = await read(platform, signal);
  signal.throwIfAborted();
  return { ...policy, noProxy: [policy.noProxy, noProxy].filter(Boolean).join(",") };
}
/** Proxy credentials must also be removed if an error body reflects them. */
export function proxySecrets(policy: ProxyPolicy): string[] {
  const secrets: string[] = [];
  for (const address of [policy.httpProxy, policy.httpsProxy]) {
    if (!address) continue;
    const url = new URL(address);
    if (url.username || url.password) {
      const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
      secrets.push(address, url.username, url.password, user, password, Buffer.from(`${user}:${password}`).toString("base64"));
    }
  }
  return [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
}
