export function toolContent(text: string) {
  const split = text.indexOf("\n\n");
  const input = split < 0 ? text : text.slice(0, split);
  const result = split < 0 ? "" : text.slice(split + 2);
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(input);
  } catch {}
  return { input, result, target: String(args.path ?? args.command ?? args.query ?? args.url ?? "") };
}
