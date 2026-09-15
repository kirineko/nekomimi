import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, ProxyAgent, fetch as httpFetch, type Dispatcher } from "undici";
import { FetchPolicyError } from "./proxy.js";

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: {
    locked: boolean;
    cancel(): Promise<void>;
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  } | null;
}
export interface FetchConnection {
  response: FetchResponse;
  close(): Promise<void>;
}
/** Programmatic transport seam; never exposed as model arguments or Web settings. */
export interface FetchNetwork {
  resolve(hostname: string): Promise<LookupAddress[]>;
  request(url: URL, addresses: LookupAddress[], signal: AbortSignal): Promise<FetchConnection>;
}
export function publicAddress(address: string): boolean {
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== "unicast") return false;
  // Exclude translation/tunnelling and non-global IPv6, including the reserved NAT64 prefixes.
  return parsed.kind() === "ipv4" || parsed.match(ipaddr.parse("2000::"), 3);
}
export function fetchUrl(input: string): URL {
  if (!input.trim() || input.length > 8192) throw new Error("URL 必须为 1–8192 字符");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("需要完整的 HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("仅支持不含凭证的 HTTP(S) URL");
  url.hash = "";
  return url;
}
/** Abandon non-cancellable DNS without connecting on a late answer. */
export function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function validateTargetName(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host) ? !publicAddress(host) : !host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))
    throw new FetchPolicyError("NON_PUBLIC_ADDRESS", "禁止抓取非公开网络地址");
}
export async function resolveTarget(url: URL, network: FetchNetwork, signal: AbortSignal) {
  signal.throwIfAborted();
  validateTargetName(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await withSignal(network.resolve(hostname), signal);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(a => isIP(a.address) !== a.family || !publicAddress(a.address)))
    throw new FetchPolicyError("NON_PUBLIC_ADDRESS", "禁止抓取非公开网络地址；域名可能被 Fake-IP DNS 映射，请检查已启用的 HTTP(S) 代理");
  return addresses;
}
export function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
    const eligible = addresses.filter(a => !family || family === a.family);
    if (!eligible.length) return callback(Object.assign(new Error("无可用公开地址"), { code: "ENOTFOUND" }), "", 0);
    if (options.all) callback(null, eligible);
    else callback(null, eligible[0]!.address, eligible[0]!.family);
  };
}
export const browserHeaders = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "accept-encoding": "gzip, deflate",
  "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document",
};
async function requestWith(dispatcher: Dispatcher, url: URL, signal: AbortSignal): Promise<FetchConnection> {
  try {
    // Fetch rewrites Sec-Fetch-Mode to cors. Apply the anonymous navigation
    // headers at the public dispatcher boundary, after Fetch normalization.
    const transport = dispatcher.compose(dispatch => (opts, handler) => dispatch({ ...opts, headers: browserHeaders }, handler));
    const response = await httpFetch(url, { method: "GET", redirect: "manual", dispatcher: transport, signal, headers: browserHeaders });
    return { response, close: async () => { await dispatcher.destroy(); } };
  } catch (error) { await dispatcher.destroy(); throw error; }
}
export async function requestViaProxy(url: URL, proxy: string, signal: AbortSignal): Promise<FetchConnection> {
  validateTargetName(url);
  signal.throwIfAborted();
  try {
    const address = new URL(proxy);
    const token = address.username || address.password
      ? `Basic ${Buffer.from(`${decodeURIComponent(address.username)}:${decodeURIComponent(address.password)}`).toString("base64")}` : undefined;
    address.username = ""; address.password = "";
    return await requestWith(new ProxyAgent({ uri: address.href, token }), url, signal);
  }
  catch {
    signal.throwIfAborted();
    // Never serialize undici causes: they may contain the proxy URI or authentication.
    throw new FetchPolicyError("PROXY_CONNECTION", "经代理抓取失败，请检查代理连接、认证及目标可达性；未回退直连");
  }
}
export const fetchNetwork: FetchNetwork = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  request: (url, addresses, signal) => requestWith(new Agent({ connect: { lookup: pinnedLookup(addresses) }, autoSelectFamily: true }), url, signal),
};
