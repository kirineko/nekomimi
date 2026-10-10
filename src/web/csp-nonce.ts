import { setNonce } from "get-nonce";

/**
 * 必须在任何 Radix / react-remove-scroll 模块求值前执行（main.tsx 首行静态导入）。
 * 服务端为每个 HTML 响应注入唯一 nonce，react-style-singleton 通过 get-nonce 读取。
 * 开发服务器（vite dev）没有替换占位符，此时不设置，保持库默认行为。
 */
export function installCspNonce(doc: Document = document) {
  const meta = doc.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
  const value = meta?.content;
  if (value && value !== "__CSP_NONCE__" && /^[A-Za-z0-9+/=]{16,}$/.test(value)) setNonce(value);
  meta?.remove();
}
installCspNonce();
