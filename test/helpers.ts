import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const temporary = () => mkdtemp(join(tmpdir(), 'harness-test-'));
export const textItem = (text = 'done') => ({ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] });
export const callItem = (name: string, args: unknown, callId = 'call_1') => ({ type: 'function_call', id: `item_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: 'completed' });
export const reasoning = { type: 'reasoning', id: 'reasoning_1', status: 'completed', content: [{ type: 'reasoning_text', text: 'Synthetic reasoning fixture.' }] };
export function events(items: Record<string, any>[], terminal = 'completed'): Record<string, any>[] {
  const output: Record<string, any>[] = [{ type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } }];
  items.forEach((item, index) => {
    output.push({ type: 'response.output_item.added', output_index: index, item: { ...item, ...(item.content ? { content: [] } : {}) } });
    if (item.type === 'message') {
      output.push({ type: 'response.content_part.added', output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      output.push({ type: 'response.output_text.delta', output_index: index, content_index: 0, delta: item.content[0].text });
    }
    if (item.type === 'reasoning') output.push({ type: 'response.reasoning_text.delta', output_index: index, content_index: 0, delta: item.content[0].text });
    output.push({ type: 'response.output_item.done', output_index: index, item });
  });
  output.push({ type: `response.${terminal}`, response: { id: 'resp_1', status: terminal, output: items, ...(terminal === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), usage: { input_tokens: 20, output_tokens: 5, input_tokens_details: { cached_tokens: 4 }, total_tokens: 25 } } });
  return output;
}
export const encode = (items: unknown[]) => items.map(e => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
export function response(items: Record<string, any>[], terminal = 'completed') { return new Response(encode(events(items, terminal)), { headers: { 'content-type': 'text/event-stream' } }); }
export const key = 'synthetic-api-key-not-real';
export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
