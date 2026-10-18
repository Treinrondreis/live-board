import test from 'node:test';
import assert from 'node:assert/strict';
import {assess,dueLeg,connections,createControlCycle,dailyControlDue,nextDailyControlAt} from './reisschema-control.mjs';
const leg={status:'active',leg_id:'leg-a',version_id:'version-a',sequence:1,role:'primary',travel_date:'2031-06-10',arrival_date:'2031-06-10',departure_time:'10:00',arrival_time:'12:00',from_station:'Example North',to_station:'Example South'};
const observation={departure_date:leg.travel_date,departure_time:'09:56',arrival_date:leg.travel_date,arrival_time:'12:10',cancelled:false,connection_broken:false,backup_communicated:false,source:'Fictional',observed_at:'2031-06-02T12:00:00.000Z'};
test('per-leg date window includes D-15, D0; fallback D-8; never inactive',()=>{
 assert.equal(dueLeg(leg,'2031-05-26',true),true);assert.equal(dueLeg(leg,'2031-05-25',true),false);
 assert.equal(dueLeg(leg,'2031-06-10',true),true);assert.equal(dueLeg(leg,'2031-06-11',true),false);
 assert.equal(dueLeg(leg,'2031-06-02',false),true);assert.equal(dueLeg({...leg,status:'replaced'},'2031-06-02',true),false);
 assert.equal(dueLeg({...leg,transport_type:'ferry'},'2031-06-02',true),true);
 assert.equal(dueLeg({...leg,transport_type:'bus'},'2031-06-02',true),false);
});
test('earlier and later departures use four-minute threshold; arrival needs consequence assessment',()=>{
 assert.equal(assess(leg,observation).urgent,true);assert.equal(assess(leg,observation).draftRequired,true);
 assert.equal(assess(leg,{...observation,departure_time:'10:04'}).draftRequired,true);
 assert.equal(assess(leg,{...observation,departure_time:'10:03'}).draftRequired,false);
 assert.equal(assess(leg,{...observation,departure_time:'10:00'}).changed,true);
});
test('connection loss requires both observed times; tighter and unchecked connections request review',()=>{
 const next={...leg,leg_id:'leg-b',sequence:2,from_station:'Example South',departure_time:'12:15',observation:{...observation,departure_time:'12:09'}};
 const first={...leg,observation};assert.equal(connections([first,next])[0].observation.connection_broken,true);
 assert.equal(connections([first,{...next,observation:{...next.observation,departure_time:'12:14'}}])[0].tightConnectionReview,true);
 assert.equal(connections([first,{...next,observation:null}])[0].observation.connection_broken,false);
 assert.equal(connections([first,{...next,observation:null}])[0].tightConnectionReview,false);
});
function harness({missing=false,failControl=false}={}){
 const kv=new Map([['reisschema-control',{value:{enabled:true},revision:1}]]),events=[];let failed=false,prepares=0,rows=[structuredClone(leg)];
 const read=async key=>structuredClone(kv.get(key)||{value:{},revision:0});
 const write=async(key,value,revision)=>{const old=kv.get(key);if((old?.revision||0)!==revision)throw Error('conflict');kv.set(key,{value:structuredClone(value),revision:revision+1});return revision+1;};
 const register={summary:async()=>({available:true,legs:rows}),recordLegEvent:async(v,k,e)=>{if(k==='control'&&failControl&&!failed){failed=true;throw Error('temporary');}const old=events.find(x=>x.e.request_id===e.request_id);if(old){assert.deepEqual(e,old.e);return;}events.push({v,k,e:structuredClone(e)});}};
 const sources={prepare:async()=>{prepares++;return {lookup:async()=>missing?{reason:'No coverage',sources:[]}:{observation:structuredClone(observation),sources:['Fictional feed v1']}};}};
 const deps={read,write,register,sources,clock:()=>Date.parse('2031-06-02T12:00:00.000Z')};
 return {deps,events,kv,get prepares(){return prepares;},set rows(value){rows=value;}};
}
test('restart resumes persisted evidence and exact request ids without duplicate checks',async()=>{
 const h=harness({failControl:true});await createControlCycle(h.deps).tick();assert.match((await h.deps.read('reisschema-control')).value.error,/niet voltooid/);
 await createControlCycle(h.deps).tick();assert.equal(h.events.filter(e=>e.k==='observation').length,1);assert.equal(h.events.filter(e=>e.k==='control').length,1);assert.equal(h.prepares,1);
 await createControlCycle(h.deps).tick();assert.equal(h.prepares,1);
});
test('missing train remains unchecked without attention, cancellation or green check',async()=>{
 const h=harness({missing:true}),cycle=createControlCycle(h.deps);await cycle.tick();assert.equal(h.events.length,1);assert.equal(h.events[0].k,'control');assert.equal(h.events[0].e.outcome,'manual');assert.equal(h.events[0].e.manual_url,'https://int.bahn.de/nl');
 assert.equal(JSON.parse(h.events[0].e.sources.at(-1)).attention,false);assert.equal((await cycle.status()).summary.manual,0);assert.equal((await cycle.status()).summary.unchecked,1);
});
test('withdrawal between lookup and commit prevents any evidence writes',async()=>{
 const h=harness();let reads=0;h.deps.register.summary=async()=>({available:true,legs:reads++?[{...leg,status:'withdrawn'}]:[leg]});await createControlCycle(h.deps).tick();assert.equal(h.events.length,0);
});

test('manual rerun on the same day records a new round; scheduled repetition remains deduplicated',async()=>{
 const h=harness(),cycle=createControlCycle(h.deps);
 await cycle.tick();const first=h.events.find(e=>e.k==='control').e.request_id;
 await cycle.tick();assert.equal(h.prepares,1);
 await cycle.tick({manual:true});assert.equal(h.prepares,2);
 assert.equal(h.events.filter(e=>e.k==='control').length,2);
 assert.notEqual(h.events.filter(e=>e.k==='control')[1].e.request_id,first);
 const status=await cycle.status();assert.equal(status.summary.checked,1);assert.equal(status.summary.pending,0);
});

test('manual retry after partial failure resumes the same round instead of creating duplicate evidence',async()=>{
 const h=harness({failControl:true});await createControlCycle(h.deps).tick({manual:true});
 await createControlCycle(h.deps).tick({manual:true});
 assert.equal(h.prepares,1);assert.equal(h.events.filter(e=>e.k==='observation').length,1);
 assert.equal(h.events.filter(e=>e.k==='control').length,1);
});

test('00:30 Amsterdam schedule follows summer/winter time and excludes 00:29',()=>{
 assert.equal(dailyControlDue(Date.parse('2026-10-24T22:29:00Z')),false);
 assert.equal(dailyControlDue(Date.parse('2026-10-24T22:30:00Z')),true);
 assert.equal(nextDailyControlAt(Date.parse('2026-10-24T22:29:00Z')),'2026-10-24T22:30:00.000Z');
 assert.equal(nextDailyControlAt(Date.parse('2026-10-24T22:31:00Z')),'2026-10-25T23:30:00.000Z');
 assert.equal(nextDailyControlAt(Date.parse('2026-03-28T23:31:00Z')),'2026-03-29T22:30:00.000Z');
});

test('scheduled round runs after 00:30 once per day, with manual checks still available',async()=>{
 const h=harness();let now=Date.parse('2031-06-01T22:29:00Z');h.deps.clock=()=>now;
 const cycle=createControlCycle(h.deps);await cycle.tick();assert.equal(h.prepares,0);
 now+=60000;await cycle.tick();assert.equal(h.prepares,1);
 h.rows=[leg,{...leg,leg_id:'new-leg'}];await cycle.tick();assert.equal(h.prepares,1);
 await cycle.tick({manual:true});assert.equal(h.prepares,2);
});

test('conflicting sources always create a manual task even at D-15',async()=>{
 const h=harness();h.rows=[{...leg,travel_date:'2031-06-17'}];
 h.deps.sources.prepare=async()=>({lookup:async()=>({sourceConflict:true,reason:'Bronnen spreken elkaar tegen',sources:['Fictional']})});
 await createControlCycle(h.deps).tick();assert.equal(h.events.length,1);assert.equal(h.events[0].e.outcome,'manual');
});

test('evidence older than four hours is looked up again after an interrupted round',async()=>{
 const h=harness({failControl:true});let now=Date.parse('2031-06-02T12:00:00Z');h.deps.clock=()=>now;
 await createControlCycle(h.deps).tick();now+=4*3600000+1;
 await createControlCycle(h.deps).tick();assert.equal(h.prepares,2);
});

test('enabling after 00:30 schedules the next night without an unexpected immediate run',async()=>{
 const h=harness(),stored=h.kv.get('reisschema-control');stored.value.enabled=false;let now=Date.parse('2031-06-02T12:00:00Z');h.deps.clock=()=>now;
 const cycle=createControlCycle(h.deps);await cycle.enable(true);await cycle.tick();assert.equal(h.prepares,0);
 await cycle.tick({manual:true});assert.equal(h.prepares,1);
 now=Date.parse('2031-06-02T22:30:00Z');await cycle.tick();assert.equal(h.prepares,2);
});

test('queue freshness uses the source fetch time, not only the later control timestamp',async()=>{
 const h=harness({failControl:true});let now=Date.parse('2031-06-02T12:00:00Z'),prepares=0;h.deps.clock=()=>now;
 h.deps.sources.prepare=async()=>{prepares++;return {lookup:async()=>({observation,sources:[JSON.stringify({downloaded_at:'2031-06-02T11:50:00Z'})]})};};
 await createControlCycle(h.deps).tick();now=Date.parse('2031-06-02T15:55:00Z');
 await createControlCycle(h.deps).tick();assert.equal(prepares,2);
});

const settle=async cycle=>{for(let i=0;i<100;i++){await new Promise(resolve=>setImmediate(resolve));if(!(await cycle.status()).running)return;}assert.fail('cycle did not settle');};
test('selected manual check only fetches requested active legs, including outside automatic window',async()=>{
 const h=harness(),other={...leg,leg_id:'leg-b',travel_date:'2031-07-10',arrival_date:'2031-07-10'};h.rows=[leg,other];let prepared;
 h.deps.sources.prepare=async rows=>{prepared=rows;return {lookup:async()=>({reason:'No coverage',sources:[]})};};
 const cycle=createControlCycle(h.deps);assert.deepEqual(await cycle.requestSelected(['leg-b']),{accepted:true,count:1});await settle(cycle);
 assert.deepEqual(prepared.map(r=>r.leg_id),['leg-b']);assert.deepEqual(h.events.map(r=>r.e.leg_id),['leg-b']);assert.equal((await cycle.status()).summary.selected,1);
});
test('selected check rejects empty, duplicate, unknown, inactive and busy selections',async()=>{
 const h=harness(),cycle=createControlCycle(h.deps);for(const ids of [[],['leg-a','leg-a'],['unknown'],Array(101).fill('leg-a')])assert.equal((await cycle.requestSelected(ids)).accepted,false);
 h.rows=[{...leg,status:'withdrawn'}];assert.equal((await cycle.requestSelected(['leg-a'])).accepted,false);h.rows=[leg];
 const state=h.kv.get('reisschema-control');state.value.leaseUntil=h.deps.clock()+10000;assert.equal((await cycle.requestSelected(['leg-a'])).accepted,false);assert.equal(h.events.length,0);
});
test('interrupted selection resumes only selected evidence before a later scheduled round',async()=>{
 const h=harness({failControl:true});h.rows=[leg,{...leg,leg_id:'leg-b'}];let cycle=createControlCycle(h.deps);
 await cycle.requestSelected(['leg-a']);await settle(cycle);assert.equal((await cycle.requestSelected(['leg-b'])).accepted,false);
 cycle=createControlCycle(h.deps);await cycle.tick();assert.deepEqual(h.events.filter(r=>r.k==='control').map(r=>r.e.leg_id),['leg-a']);assert.equal(h.prepares,1);
 await cycle.tick();assert.equal((await cycle.status()).summary.selected,2);
});
