import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {arrivalSelector} from './arrival-collection.mjs';
import {normalizeReportEvent} from './day-reports.mjs';
import {initAnalytics,recordStopSummaries,readAnalytics} from './train-analytics.mjs';
import {defaultReportSource,reportGroups} from './public/train-report-config.mjs';
import {reportSelection} from './train-report.mjs';

test('ICE arrival registration keeps arrival and departure as separate real events',async()=>{
  const source=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  const ctx=vm.createContext({Date,Intl,Set,config:{allowedCategories:['ICE']}});
  vm.runInContext(source.slice(source.indexOf('const DB_TIME_ZONE='),source.indexOf('async function fetchMergedStation(')),ctx);
  const stop={id:'fictional-stop',tl:{c:'ICE',n:'99999'},hasRealtime:true,ar:{pt:'2611071200',ct:'2611071210',pp:'1'},dp:{pt:'2611071205',ct:'2611071218',pp:'1'}};
  const station={name:'Frankfurt(M) Flughafen Fernbf',eva:'example'};
  const selector=arrivalSelector([stop]);assert.deepEqual(selector.arrivalTrainNumbers,['99999']);
  const arrival=ctx.rowsForSelector([stop],station,selector)[0];
  const departure=ctx.rowsForSelector([stop],station,{trainNumbers:['99999'],categories:['ICE']})[0];
  assert.equal(arrival.eventMode,'arrival');assert.equal(arrival.delay,10);assert.equal(departure.eventMode,'departure');assert.equal(departure.delay,13);
  assert.equal(arrival.actualTimestamp,null);assert.equal(arrival.hasRealtime,true);
  const sqlite=new DatabaseSync(':memory:');await initAnalytics({sqlite});
  await recordStopSummaries([arrival,departure].map(t=>normalizeReportEvent(t,'DB',Date.parse('2026-11-07T12:30:00Z'))));
  const rows=(await readAnalytics({from:'2026-11-07',to:'2026-11-07',train:'99999'})).rows;
  assert.equal(rows.length,2);assert.equal(rows.find(r=>r.mode==='arrival').delay,10);assert.equal(rows.find(r=>r.mode==='departure').delay,13);
  const cancelled=ctx.rowsForSelector([{...stop,ar:{...stop.ar,cs:'c'}}],station,selector)[0];assert.equal(cancelled.cancelled,true);assert.equal(departure.cancelled,false);
  const planned=ctx.rowsForSelector([{...stop,hasRealtime:false,ar:{pt:stop.ar.pt}}],station,selector)[0];assert.equal(normalizeReportEvent(planned,'DB',Date.now()).realtime,false);
  sqlite.close();
});
test('arrival selector includes Railjet and all other train categories, regardless of board category filters',()=>{
 const source=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
 const ctx=vm.createContext({Date,Intl,Set,config:{allowedCategories:['ICE']}});
 vm.runInContext(source.slice(source.indexOf('const DB_TIME_ZONE='),source.indexOf('async function fetchMergedStation(')),ctx);
 const categories=['ICE','RJ','RJX','IC','EC','ECE','NJ','EN','RE','RB','S','TGV','FLX','OTHER'];
 const stops=categories.map((c,i)=>({id:'fictional-'+i,tl:{c,n:String(99000+i)},hasRealtime:true,ar:{pt:'2611071200',ct:'2611071207'},dp:{pt:'2611071205',ct:'2611071218'}}));
 const selector=arrivalSelector(stops),rows=ctx.rowsForSelector(stops,{name:'Wien Hbf',eva:'example'},selector);
 assert.equal(rows.length,categories.length);assert.deepEqual(Array.from(rows,r=>r.category),categories);
 assert.ok(rows.every(r=>r.eventMode==='arrival'&&r.delay===7));
 // The original departure selection still respects its configured categories.
 assert.equal(ctx.rowsForSelector(stops,{name:'Wien Hbf'}, {trainNumbers:selector.trainNumbers,categories:['ICE']}).length,1);
});
test('arrival selector excludes departure-only or unusable stops, and deduplicates train numbers',()=>{
 assert.equal(arrivalSelector([{tl:{c:'RJ',n:'99998'},dp:{pt:'2611071200'}},{tl:{c:'IC',n:'99997'},ar:{ct:'2611071207'}},{tl:{c:'EC'},ar:{pt:'2611071200'}}]),null);
 assert.deepEqual(arrivalSelector([{tl:{c:'RJ',n:'99999'},ar:{pt:'2611071200'}},{tl:{c:'RJ',n:'99999'},ar:{pt:'2611071200'}}]).trainNumbers,['99999']);
});

test('Dutch report stations default to NDOV but an explicit source stays selectable',()=>{
  for(const group of reportGroups)for(const station of group.stations.filter(s=>['Amsterdam Centraal','Amersfoort Centraal','Deventer','Hengelo','Utrecht Centraal','Arnhem Centraal'].includes(s))){
    assert.equal(defaultReportSource(group,station),'NDOV');assert.equal(reportSelection({group:group.id,station}).source,'NDOV');assert.equal(reportSelection({group:group.id,station,source:'DB'}).source,'DB');
  }
});

test('German report stations default to DB, including Berlin',()=>{
 for(const group of reportGroups)for(const station of group.stations.filter(s=>/Berlin|Hannover|Hamburg|Osnabrück|Bad Bentheim|Frankfurt|Mannheim|Köln|Düsseldorf|Stuttgart|München/.test(s)))assert.equal(defaultReportSource(group,station),'DB');
});
