/** Literal-only CSS colors. Kept self-contained so the same parser can run in opaque frames. */
export function normalizeColor(input: unknown): string {
  if (typeof input !== 'string' || input.length > 128) throw new Error('Invalid color literal');
  const value = input.trim().toLowerCase();
  if (value === 'transparent') return '#00000000';
  if (/^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/.test(value))
    return value.length <= 5 ? '#' + [...value.slice(1)].map(c => c + c).join('') : value;
  const match = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(value);
  if (!match) throw new Error('Invalid color literal');
  const parts = match[2]!.trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length < 3 || parts.length > 4) throw new Error('Invalid color components');
  const numeric = (s: string, max: number, percent = false) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(s)) throw new Error('Invalid color number');
    const n = parseFloat(s), pct = s.endsWith('%');
    if (percent && !pct || n < 0 || n > (pct ? 100 : max)) throw new Error('Invalid color range');
    return pct ? n * max / 100 : n;
  };
  const alpha = parts[3] === undefined ? 1 : numeric(parts[3], 1);
  let rgb: number[];
  if (match[1]!.startsWith('rgb')) rgb = parts.slice(0, 3).map(s => numeric(s, 255));
  else {
    const hue = parts[0]!.replace(/deg$/, '');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(hue) || !Number.isFinite(Number(hue))) throw new Error('Invalid hue');
    const h = ((Number(hue) % 360) + 360) % 360 / 60;
    const s = numeric(parts[1]!, 1, true), l = numeric(parts[2]!, 1, true);
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
    rgb = (h < 1 ? [c,x,0] : h < 2 ? [x,c,0] : h < 3 ? [0,c,x] : h < 4 ? [0,x,c] : h < 5 ? [x,0,c] : [c,0,x]).map(n => (n + m) * 255);
  }
  return '#' + [...rgb, ...(alpha === 1 ? [] : [alpha * 255])].map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
}
