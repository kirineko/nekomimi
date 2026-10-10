import {expect,it} from 'vitest';
import {workbenchThemeCss} from '../src/web/v2/theme-css.js';
it('maps declared theme tokens to new controls and rows without old selectors',()=>{
  const css=workbenchThemeCss({id:'fixture',title:'Fixture',colors:{background:'#fff',surface:'#eee',accent:'#8050c0',foreground:'#123'},typography:{size:17,family:'猫咪',fallback:'sans-serif'},radii:{control:9,bubble:20},spacing:{scale:.9,controlPadding:10},bubbles:{style:'tail'},motion:{preset:'float'}});
  expect(css).toContain('--surface:#ffffff');expect(css).toContain('--panel:#eeeeee');expect(css).toContain('--brand:#8050c0');expect(css).toContain('[data-slot=button]');expect(css).toContain('[data-row-kind=user]');expect(css).toContain('prefers-reduced-motion');
  expect(css).not.toMatch(/\.row-user|\.composer|\.topbar|\.app\b/);
  expect(workbenchThemeCss({id:'empty',title:'Empty'})).not.toContain('--brand:');
});
it('rejects selectors, scripts and external theme assets before creating a stylesheet',()=>{
  for(const patch of [{css:'body{display:none}'},{typography:{family:'x";color:red'}},{assetsData:{font:'https://example.invalid/a.woff'}},{assetsData:{background:'data:image/svg+xml;base64,AAAA'}}])expect(()=>workbenchThemeCss({id:'bad',title:'Bad',...patch} as any)).toThrow();
});
