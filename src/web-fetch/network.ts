import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as httpFetch } from "undici";

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
export async function resolveTarget(url: URL, network: FetchNetwork, signal: AbortSignal) {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await withSignal(network.resolve(hostname), signal);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(a => isIP(a.address) !== a.family || !publicAddress(a.address)))
    throw new Error("禁止抓取非公开网络地址");
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
export const fetchNetwork: FetchNetwork = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  async request(url, addresses, signal) {
    // Per-call dispatcher: never inherit proxy credentials or a global DNS override.
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) }, autoSelectFamily: true });
    try {
      const response = await httpFetch(url, {
        method: "GET", redirect: "manual", dispatcher, signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; Nekomimi/0.1; web_fetch)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,application/xml;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "accept-encoding": "gzip, deflate",
        },
      });
      return { response, close: async () => { await dispatcher.destroy(); } };
    } catch (error) { await dispatcher.destroy(); throw error; }
  },
};
