import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readableTurns } from '../src/web/v2/routes/readable-turns.js';
import { TurnHeading } from '../src/web/v2/routes/turn-heading.js';
import type { TimelineRow } from '../src/shared/protocol.js';
const row=(id:string,kind:TimelineRow['kind'],status?:string,text=''):TimelineRow=>({id,kind,status,text,seq:1,runId:'run',title:kind==='status'?'任务结束':'模型调用',refs:[]});
it('retains failure, cancellation and unknown results in a grouped turn',()=>{
 for(const status of ['failed','cancelled','interrupted','incomplete','unknown']) {
  const end=row('end','status',status,'结果需要检查');
  const [turn]=readableTurns([row('call','call','completed'),end]);
  expect(turn!.rows.slice(1)).toEqual([end]);expect(turn!.summaryOnly).toBe(true);expect(turn!.status).toBe(status);
 }
});
it('folds successful status and keeps auxiliary calls reachable',()=>{
 const naming={...row('name','call','completed'),title:'会话命名'};
 const answer=row('text','assistant',undefined,'回答正文');
 const rows=[row('call','call','completed'),answer,row('end','status','completed'),naming];
 const [turn]=readableTurns(rows);
 expect(turn!.rows.slice(1)).toEqual([answer]);expect(turn!.summaryOnly).toBe(true);
 const html=renderToStaticMarkup(createElement(TurnHeading,{turn:turn!}));
 expect(html).toContain('全部调用');expect(html).toContain('会话命名');
 expect(rows).toHaveLength(4);
});
it('shows one terminal failure and keeps recovered attempts out of the main content',()=>{
 const failed=row('call','call','incomplete','Response incomplete');
 const end=row('end','status','incomplete','Response incomplete');
 expect(readableTurns([failed,end])[0]!.rows.slice(1)).toEqual([end]);
 const recovered=readableTurns([failed,row('retry','call','completed'),row('end','status','completed')])[0]!;
 expect(recovered.summaryOnly).toBe(true);expect(recovered.calls).toContain(failed);
 expect(recovered.status).toBe('completed');
});
it('preserves partial-page failures and never joins interrupted runs or missing identities',()=>{
 const failed=row('partial','call','unknown','需要核对');
 const other={...row('other','assistant',undefined,'另一轮'),runId:'other'};
 const noRun={...row('missing','call','running'),runId:undefined};
 const turns=readableTurns([failed,other,row('later','call','running'),noRun]);
 expect(turns.map(t=>t.id)).toEqual(['partial','other','later','missing']);
 expect(turns[0]!.rows).toEqual([failed]);expect(turns[0]!.summaryOnly).toBe(false);
 expect(turns[2]!.status).toBe('running');expect(turns[2]!.summaryOnly).toBe(true);
});

it('keeps saved extension results and first-row identity when a reply arrives',()=>{
 const call=row('call','call','running');
 const saved={...row('saved','status','completed'),title:'扩展结果',details:{kind:'panel'}};
 const before=readableTurns([call])[0]!,after=readableTurns([call,row('reply','assistant',undefined,'回答'),saved])[0]!;
 expect(before.rows[0]).toBe(after.rows[0]);expect(after.rows).toContain(saved);
 const unknown=row('partial','call','unknown','需要核对');
 expect(readableTurns([unknown,saved])[0]!.rows).toContain(unknown);
 expect(readableTurns([unknown,saved])[0]!.summaryOnly).toBe(false);
});

it('does not infer task success from a successful attempt on a partial page',()=>{
 const [turn]=readableTurns([row('call','call','completed')]);
 expect(turn!.status).toBeUndefined();
 const html=renderToStaticMarkup(createElement(TurnHeading,{turn:turn!}));
 expect(html).toContain('当前记录未包含任务结束状态');
 expect(turn!.summaryOnly).toBe(true);
});
