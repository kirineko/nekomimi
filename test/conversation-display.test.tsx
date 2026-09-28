import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timeline } from '../src/web/components/Timeline.js';
import type { TimelineRow } from '../src/shared/protocol.js';
const row=(id:string,kind:TimelineRow['kind'],status?:string,text=''):TimelineRow=>({id,kind,status,text,seq:1,runId:'run',title:'模型调用',refs:[]});
const render=(rows:TimelineRow[])=>renderToStaticMarkup(createElement(Timeline,{sessionId:'s',rows,inspect:()=>{},older:()=>{},hasOlder:false}));
it('retains failure, cancellation and unknown results in a grouped turn',()=>{
 for(const status of ['failed','cancelled','interrupted','incomplete']) {
  const html=render([row('call','call','completed'),row('end','status',status,'结果需要检查')]);
  expect(html).toContain('结果需要检查');
  expect(html).toContain('检查调用');
 }
});
it('folds successful status and keeps auxiliary calls reachable',()=>{
 const naming={...row('name','call','completed'),title:'会话命名'};
 const html=render([row('call','call','completed'),row('text','assistant',undefined,'回答正文'),row('end','status','completed'),naming]);
 expect(html).not.toContain('row-status');
 expect(html).toContain('回答正文');
 expect(html).toContain('全部调用');
 expect(html).toContain('会话命名');
});
it('shows one readable terminal failure and keeps unsuccessful attempts in the inspector',()=>{
 const html=render([row('call','call','incomplete','Response incomplete'),row('end','status','incomplete','Response incomplete')]);
 expect(html).not.toContain('Response incomplete');expect(html.match(/本次回复未完整生成/g)).toHaveLength(1);expect(html).toContain('检查调用');
 const recovered=render([row('call','call','incomplete','Response incomplete'),row('retry','call','completed'),row('end','status','completed')]);expect(recovered).not.toContain('Response incomplete');
});
