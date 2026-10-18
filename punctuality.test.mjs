import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPunctualityArchive,punctualityLegMatches,punctualityRow,snapshotPunctualityRows} from './punctuality.mjs';
import {punctualityView} from './punctuality-view.mjs';
import {initBoardCache,cleanupHistory} from './board-cache.mjs';
const at=Date.parse('2031-06-10T08:30:00Z'),planned=at-30*60000;
const leg={status:'active',leg_id:'fictional-leg',version_id:'fictional-version',train_number:'ICE 700',from_station:'Example North',to_station:'Example South',travel_date:'2031-06-10',arrival_date:'2031-06-11',departure_time:'10:00',arrival_time:'00:30'};
const train={number:'700',observedAt:'Example North',eventMode:'departure',plannedTimestamp:planned,expectedTimestamp:planned+12*60000,hasRealtime:true};
async function fixture(options={}){const sqlite=new DatabaseSync(':memory:'),archive=createPunctualityArchive({sqlite},{getLegs:async()=>({available:true,legs:[leg]}),clock:()=>at,...options});await archive.init();return {sqlite,archive};}
test('planned-only and departed flags are not actual or on-time proof; actual timestamps must be confirmed in the past',()=>{
 assert.equal(punctualityRow({...train,hasRealtime:false,departed:true},'DB',at),null);
 assert.equal(punctualityRow({...train,actualTimestamp:at+120000},'DB',at),null);
 assert.equal(punctualityRow(train,'DB',at).kind,'expected');
 assert.equal(punctualityRow({...train,actualTimestamp:planned+11*60000},'DB',at).kind,'actual');
});
test('overnight endpoints match the actual event calendar date, not the train origin day',()=>{
 const arrival=punctualityRow({...train,observedAt:'Example South',eventMode:'arrival',plannedTimestamp:Date.parse('2031-06-10T22:30Z'),expectedTimestamp:Date.parse('2031-06-10T22:45Z')},'DB',at+86400000);
 assert.equal(punctualityLegMatches(arrival,leg),true);
 assert.equal(punctualityLegMatches({...arrival,planned_at:arrival.planned_at+86400000},leg),false);
 assert.equal(punctualityLegMatches(arrival,{...leg,train_number:'ICE 701'}),false);
});
test('booked and screen-selected measurements persist, unchanged polling is deduplicated, raw/customer fields never stored',async()=>{
 const {sqlite,archive}=await fixture({screenMatch:t=>t.number==='701'});
 await archive.record([{...train,privateCustomer:'NEVER_STORE'}],'DB',at);
 await archive.record([train],'DB',at+1000);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM punctuality_events').get().n,1);
 let rows=await archive.history(leg.leg_id);assert.equal(rows.length,1);assert.equal(rows[0].last_seen_at,at+1000);assert.doesNotMatch(JSON.stringify(rows),/NEVER_STORE/);
 await archive.record([{...train,number:'701'}],'DB',at+2000);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM punctuality_events').get().n,2);
 await archive.record([{...train,number:'702'}],'DB',at+3000);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM punctuality_events').get().n,2);
 sqlite.close();
});
test('permanent history keeps changed predictions; actual wins over later predictions without changing baseline',async()=>{
 const {sqlite,archive}=await fixture();
 await archive.record([train],'DB',at);
 await archive.record([{...train,actualTimestamp:planned+11*60000}],'DB',at+1000);
 await archive.record([{...train,expectedTimestamp:planned+15*60000}],'DB',at+2000);
 const [row]=await archive.enrich([leg]);assert.equal(row.departure_time,'10:00');assert.equal(row.punctuality.departure.kind,'actual');assert.equal(row.punctuality.departure.delay_minutes,11);
 assert.equal((await archive.history(leg.leg_id)).length,3);
 const p=punctualityView(row,'departure');assert.equal(p.label,'+11');assert.equal(p.kind,'Werkelijk');assert.equal(p.time,'10:11');
 // A fresh service instance reads the same retained database; no TTL is applied.
 const restarted=createPunctualityArchive({sqlite});await restarted.init();assert.equal((await restarted.history(leg.leg_id)).length,3);sqlite.close();
});
test('snapshots keep arrival and departure separate and require an explicit realization marker',()=>{
 const rows=snapshotPunctualityRows({trainNumber:'700',sourceTimestamp:at,stops:[{station:'Example North',departure:{plannedTime:planned,realtime:true,expectedTime:planned+12*60000},arrival:{plannedTime:planned-60000,realizationConfirmed:true,actualTime:planned}}]});
 assert.equal(rows[0].eventMode,'arrival');assert.equal(rows[0].actualTimestamp,planned);assert.equal(rows[1].eventMode,'departure');assert.equal(rows[1].actualTimestamp,null);
});
test('normal board retention deletes old temporary rows but leaves permanent punctuality and leg links intact',async()=>{
 const {sqlite,archive}=await fixture();await archive.record([train],'DB',at);
 sqlite.exec(`CREATE TABLE train_observations(id TEXT,category TEXT,observed_at BIGINT,planned_timestamp BIGINT);
 CREATE TABLE event_observations(observation_uid TEXT,category TEXT,observed_at BIGINT,planned_timestamp BIGINT);
 CREATE TABLE event_current_state(event_key TEXT,service_uid TEXT);
 CREATE TABLE service_runs(service_uid TEXT,service_date TEXT,category TEXT);
 CREATE TABLE train_observation_state(state_key TEXT,last_seen_at BIGINT);
 CREATE TABLE ingest_batches(batch_uid TEXT,observed_at BIGINT);
 CREATE TABLE journey_archive(journey_id TEXT,state_json TEXT,service_date TEXT);
 CREATE TABLE journey_archive_revisions(revision_id TEXT,journey_id TEXT);`);
 sqlite.prepare('INSERT INTO train_observations VALUES(?,?,?,?)').run('fictional','ICE',at,planned);
 await initBoardCache({sqlite});await cleanupHistory(at+366*86400000);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM train_observations').get().n,0);
 assert.equal((await archive.history(leg.leg_id)).length,1);sqlite.close();
});
test('a later registered itinerary reuses the already retained board measurements',async()=>{
 const {sqlite,archive}=await fixture({getLegs:async()=>({available:true,legs:[]}),screenMatch:()=>true});
 await archive.record([train],'DB',at);assert.equal((await archive.history(leg.leg_id)).length,0);
 archive.configure({getLegs:async()=>({available:true,legs:[leg]})});await archive.record([],'DB',at+1000);
 assert.equal((await archive.history(leg.leg_id)).length,1);sqlite.close();
});
