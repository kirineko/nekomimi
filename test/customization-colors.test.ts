import { expect, test } from 'vitest';
import { normalizeColor } from '../src/shared/color.js';
import { validateTheme } from '../src/customization/ui-contract.js';
import { panelDocument } from '../src/customization/panel-document.js';
test('literal colors share normalization without a contrast gate', () => {
  for (const [input, output] of [['#AbC','#aabbcc'],['#abcd','#aabbccdd'],['rgb(255, 0, 128)','#ff0080'],['rgb(100% 0% 0% / 50%)','#ff000080'],['hsl(240 100% 50%)','#0000ff'],['transparent','#00000000']]) expect(normalizeColor(input)).toBe(output);
  expect(() => validateTheme({id:'pink',title:'粉白',colors:{foreground:'#fff',surface:'#fff',accent:'rgba(255, 220, 240, 0.5)'}})).not.toThrow();
  for (const input of ['var(--x)','url(x)','red; color: blue','rgb(Infinity,0,0)','rgb(256,0,0)','hsl(0 10 20)','calc(0)','<script>']) expect(() => normalizeColor(input)).toThrow();
  const html = panelDocument({instanceId:'test',nonce:'test',bundle:'',css:'',props:{},actions:[],theme:{accent:'hsl(240 100% 50%)'}});
  expect(html).toContain('--panel-accent:#0000ff');
  expect(html).toContain('Invalid color literal');
});
