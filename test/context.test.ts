import { it, expect } from 'vitest';
import { join } from 'node:path';
import { Journal } from '../src/journal.js';
import { CoreTools } from '../src/tools.js';
import { assemblePrompt, contextView } from '../src/context.js';
import { temporary } from './helpers.js';
it('removes disabled guidance and builds deterministic, sourced context', async () => {
  const dir = await temporary(); const j = await Journal.open(join(dir, 's'));
  try {
    const tools = (await CoreTools.create(dir, j, {})).definitions();
    const enabled = tools.filter(d => d.tool.name !== 'edit');
    const a = assemblePrompt(enabled, [{ source: 'test:project', text: 'Project rule' }]);
    expect(a).toEqual(assemblePrompt([...enabled].reverse(), [{ source: 'test:project', text: 'Project rule' }]));
    expect(a.text).not.toContain('oldText'); expect(a.schemas.some(s => s.name === 'edit')).toBe(false);
    const event = await j.append('context.add', { source: 'user', item: { role: 'user', content: 'hello' } });
    const view = contextView(j.events, a); expect(view.nodes[0]).toMatchObject({ source: 'user', eventId: event.eventId, seq: event.seq }); expect(view.nodes[0]?.hash).toHaveLength(64);
  } finally { await j.close(); }
});
