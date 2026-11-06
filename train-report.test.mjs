import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initAnalytics,recordStopSummaries} from './train-analytics.mjs';
import {reportSelection,readTrainReport,journeyReportRows} from './train-report.mjs';
import {delayClass,reportNumbers,reportGroups} from './public/train-report-config.mjs';

const now=Date.parse('2026-11-07T11:00:00Z');
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE journey_archive(train_number TEXT,service_date TEXT,state_json TEXT)');const q=async(sql,args=[])=>{const bound=[];return sqlite.prepare(sql.replace(/\$(\d+)/g,(_,n)=>{bound.push(args[+n-1]);return '?';})).all(...bound);};return{sqlite,q};}
const event={date:'2026-11-06',number:'141',category:'ICE',source:'DB',station:'Berlin Hbf',mode:'arrival',planned:Date.parse('2026-11-06T12:00:00Z'),observedAt:Date.parse('2026-11-06T12:20:00Z'),delay:20,realtime:true,cancelled:false};

test('report uses full 30/60/90 completed local calendar days and rejects invalid filters',()=>{
  const s=reportSelection({group:'swiss',days:'90'},now);assert.equal(s.dates.length,90);assert.equal(s.to,'2026-11-06');assert.equal(s.from,'2026-08-09');
  assert.equal(reportSelection({group:'swiss'},Date.parse('2026-11-06T23:30:00Z')).to,'2026-11-06');
  for(const filters of [{group:'unknown'},{group:'swiss',source:'DB_PLAN'},{group:'swiss',station:"x' OR 1=1"},{group:'swiss',days:'100'}])assert.throws(()=>reportSelection(filters,now));
});
test('exact colour boundaries and inclusive replacement dates',()=>{
  assert.deepEqual([0,15,16,30,31,59,60,85].map(delayClass),['good','good','warn','warn','bad','bad','severe','severe']);
  const g=reportGroups.find(g=>g.id==='swiss');
  for(const d of ['2027-05-15','2027-07-09'])assert.deepEqual(reportNumbers(g,d),['1074','1072']);
  for(const d of ['2027-05-14','2027-07-10'])assert.deepEqual(reportNumbers(g,d),['108','106']);
});
test('latest arrival rather than peak or departure; exact sources and missingness',async()=>{
  const {sqlite,q}=database();await initAnalytics({sqlite});
  await recordStopSummaries([{...event,delay:70},{...event,delay:15,observedAt:event.observedAt+60000},{...event,mode:'departure',delay:99},{...event,source:'DB_PLAN',delay:0},{...event,source:'NDOV',delay:8},{...event,source:'NDOV_RIT',delay:9,observedAt:event.observedAt+60000}]);
  let r=await readTrainReport(q,{group:'berlin-east',source:'DB'},now);assert.equal(r.rows.length,30);assert.equal(r.rows[0].cells[0].delay,15);assert.equal(r.rows[0].cells[1].status,'unknown');assert.equal(r.rows[1].cells[0].status,'unknown');
  r=await readTrainReport(q,{group:'berlin-east',source:'NDOV'},now);assert.equal(r.rows[0].cells[0].delay,9);assert.equal(r.rows[0].cells[0].source,'NDOV_RIT');sqlite.close();
});
test('cancellation applies to selected stop; historical cancellation can be withdrawn',async()=>{
  const {sqlite,q}=database();await initAnalytics({sqlite});await recordStopSummaries([{...event,cancelled:true},{...event,station:'Berlin Gesundbrunnen',delay:3}]);
  let r=await readTrainReport(q,{group:'berlin-east',source:'DB'},now);assert.equal(r.rows[0].cells[0].status,'cancelled');
  await recordStopSummaries([{...event,observedAt:event.observedAt+60000,delay:4}]);r=await readTrainReport(q,{group:'berlin-east',source:'DB'},now);assert.equal(r.rows[0].cells[0].status,'measured');assert.equal(r.rows[0].cells[0].delay,4);sqlite.close();
});
test('Berlin fallback uses only matching arrival and does not replace usable Hbf data',async()=>{
  const {sqlite,q}=database();await initAnalytics({sqlite});await recordStopSummaries([{...event,realtime:false,delay:0},{...event,station:'Berlin Gesundbrunnen',delay:12}]);
  let r=await readTrainReport(q,{group:'berlin-east',source:'DB'},now);assert.equal(r.rows[0].cells[0].station,'Berlin Gesundbrunnen');assert.equal(r.rows[0].cells[0].delay,12);
  await recordStopSummaries([{...event,observedAt:event.observedAt+60000,delay:5}]);r=await readTrainReport(q,{group:'berlin-east',source:'DB'},now);assert.equal(r.rows[0].cells[0].station,'Berlin Hbf');sqlite.close();
});
test('batch query includes all days beyond old 100-row pagination and station aliases',async()=>{
  const {sqlite,q}=database();await initAnalytics({sqlite});const selection=reportSelection({group:'frankfurt-east',days:90,source:'DB'},now);
  for(const date of selection.dates)for(const number of selection.group.trains)await recordStopSummaries([{...event,date,number,station:'Frankfurt(M) Flughafen Fernbf',planned:Date.parse(date+'T12:00:00Z')}]);
  const r=await readTrainReport(q,{group:'frankfurt-east',days:90,source:'DB'},now);assert.equal(r.rows.flatMap(r=>r.cells).filter(c=>c.status==='measured').length,630);sqlite.close();
});
test('Nightjet combined numbers retain source identity and cancelled measurements cannot turn green',async()=>{
  const {sqlite,q}=database();await initAnalytics({sqlite});
  await recordStopSummaries([{...event,category:'NJ',number:'421',station:'Wien Hbf',source:'NDOV_RIT',delay:85}]);
  let r=await readTrainReport(q,{group:'nightjet-east',source:'NDOV'},now);assert.equal(r.rows[0].cells[0].number,'40421');assert.equal(r.rows[0].cells[0].delay,85);
  await recordStopSummaries([{...event,cancelled:true},{...event,realtime:false,observedAt:event.observedAt+60000}]);
  r=await readTrainReport(q,{group:'berlin-east',source:'DB'},now);assert.equal(r.rows[0].cells[0].status,'unknown');sqlite.close();
});

test('full journey arrivals are read without promoting timetable-only fields to measurements',async()=>{
 const {sqlite,q}=database();await initAnalytics({sqlite});
 const planned=Date.parse('2026-11-06T17:00:00Z'),at=planned+9*60000;
 const state={trainNumber:'146',category:'ICE',stops:[{station:'Amsterdam Centraal',arrival:{planning:{time:planned,source:'NDOV_IFF'},realtime:{source:'NDOV_RIT',recordedAt:at,sourceTimestamp:at,expectedTime:planned+8*60000,cancelled:false}}}]};
 sqlite.prepare('INSERT INTO journey_archive VALUES(?,?,?)').run('146','2026-11-06',JSON.stringify(state));
 const report=await readTrainReport(q,{group:'berlin-west',source:'NDOV'},now);assert.equal(report.rows[0].cells[1].delay,8);assert.equal(report.rows[0].cells[1].source,'NDOV_RIT');
 const selection=reportSelection({group:'berlin-west',source:'NDOV'},now);
 delete state.stops[0].arrival.realtime;assert.deepEqual(journeyReportRows([{state_json:JSON.stringify(state)}],selection),[]);
 state.stops[0].arrival.realtime={source:'NDOV_RIT',recordedAt:at,expectedTime:null,cancelled:true};
 assert.equal(journeyReportRows([{state_json:JSON.stringify(state)}],selection)[0].measured_at,at);
 assert.deepEqual(journeyReportRows([{state_json:JSON.stringify(state)}],reportSelection({group:'berlin-west',source:'DB'},now)),[]);
 sqlite.close();
});
