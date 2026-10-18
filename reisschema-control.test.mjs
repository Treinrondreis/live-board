import test from 'node:test';
import assert from 'node:assert/strict';
import {assess,dueLeg,connections,createControlCycle} from './reisschema-control.mjs';
const leg={status:'active',leg_id:'leg-a',version_id:'version-a',sequence:1,role:'primary',travel_date:'2031-06-10',arrival_date:'2031-06-10',departure_time:'10:00',arrival_time:'12:00',from_station:'Example North',to_station:'Example South'};
const observation={departure_date:leg.travel_date,departure_time:'09:56',arrival_date:leg.travel_date,arrival_time:'12:10',cancelled:false,connection_broken:false,backup_communicated:false,source:'Fictional',observed_at:'2031-06-02T12:00:00.000Z'};
test('per-leg date window includes D-15, D0; fallback D-8; never inactive',()=>{
 assert.equal(dueLeg(leg,'2031-05-26',true),true);assert.equal(dueLeg(leg,'2031-05-25',true),false);
 assert.equal(dueLeg(leg,'2031-06-10',true),true);assert.equal(dueLeg(leg,'2031-06-11',true),false);
 assert.equal(dueLeg(leg,'2031-06-02',false),true);assert.equal(dueLeg({...leg,status:'replaced'},'2031-06-02',true),false);
 assert.equal(dueLeg({...leg,transport_type:'ferry'},'2031-06-02',true),false);
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
 assert.equal(connections([first,{...next,observation:null}])[0].tightConnectionReview,true);
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
test('missing train becomes manual DB task, never a cancellation or green check',async()=>{
 const h=harness({missing:true});await createControlCycle(h.deps).tick();assert.equal(h.events.length,1);assert.equal(h.events[0].k,'control');assert.equal(h.events[0].e.outcome,'manual');assert.equal(h.events[0].e.manual_url,'https://int.bahn.de/nl');
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
