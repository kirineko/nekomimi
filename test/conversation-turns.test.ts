import { it, expect } from "vitest";
import { conversationTurns } from "../src/web/turns.js";
import type { TimelineRow } from "../src/shared/protocol.js";
const row=(id:string,runId?:string):TimelineRow=>({id,runId,seq:1,kind:'call',text:'',title:'',refs:[]});
it('keeps missing run IDs and partial pages distinct without reordering evidence',()=>{
 const rows=[row('a','run-a'),row('b','run-a'),row('c'),row('d','run-b'),row('e','run-a')];
 const groups=conversationTurns(rows);
 expect(groups.map(g=>g.rows.map(r=>r.id))).toEqual([['a','b'],['c'],['d'],['e']]);
 expect(groups.flatMap(g=>g.rows)).toEqual(rows);
 expect(rows).toHaveLength(5);
});
