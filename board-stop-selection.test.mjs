import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNextBoardStop,selectBoardStops} from './board-stop-selection.mjs';
const now=Date.parse('2031-06-10T12:00:00Z');
const row=(station,minutes,extra={})=>({number:'700',observedAt:station,eventMode:'departure',plannedTimestamp:now+minutes*60000,expectedTimestamp:now+minutes*60000,hasRealtime:true,...extra});
test('next current stop wins over a closer already-passed stop',()=>{
 const previous=row('Example A',-1),next=row('Example B',12);assert.equal(chooseNextBoardStop([previous,next],now),next);
});
test('delay uses expected time; upcoming planned-only stop beats past realtime stop',()=>{
 const delayed=row('Example A',-50,{expectedTimestamp:now+3*60000}),next=row('Example B',20);assert.equal(chooseNextBoardStop([next,delayed],now),delayed);
 const planned=row('Example C',5,{hasRealtime:false,expectedTimestamp:now-60*60000});assert.equal(chooseNextBoardStop([row('Example D',-2),planned],now),planned);
});
test('one row across providers and measurement modes; most recent past stop if all passed',()=>{
 const rows=[row('Example A',-10,{source:'DB'}),row('Example B',-2,{source:'NDOV'}),row('Example B',-3,{eventMode:'arrival'})];assert.deepEqual(selectBoardStops(rows,now),[rows[1]]);
});
test('only partial cancellation at different stops permits a second row',()=>{
 const cancelled=row('Example A',-5,{cancelled:true}),active=row('Example B',5);assert.deepEqual(selectBoardStops([cancelled,active,row('Example C',15)],now),[active,cancelled]);
 assert.equal(selectBoardStops([cancelled,row('Example C',10,{cancelled:true})],now).length,1);
 assert.equal(selectBoardStops([row('Example B',5,{cancelled:true,eventMode:'arrival'}),active],now).length,1);
});
test('newer provider evidence for same stop replaces an older cancellation',()=>{
 const old=row('Example A',5,{cancelled:true,messageTimestamp:now-120000}),fresh=row('Example A',5,{messageTimestamp:now});assert.deepEqual(selectBoardStops([old,fresh],now),[fresh]);
});
test('display selection does not mutate the measured records',()=>{
 const rows=[row('Example A',-3),row('Example B',8)],before=structuredClone(rows);selectBoardStops(rows,now);assert.deepEqual(rows,before);
});
