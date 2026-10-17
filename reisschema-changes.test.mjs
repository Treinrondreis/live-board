import test from 'node:test';
import assert from 'node:assert/strict';
import {observationFromPlans,enrichChanges,changeKey} from './reisschema-changes.mjs';
const leg=(extra={})=>({leg_id:'fictional-leg',version_id:'fictional-version',sequence:1,role:'primary',created_at:'2031-06-01T12:00:00Z',train_number:'TEST 700',travel_date:'2031-06-10',arrival_date:'2031-06-10',from_station:'Example North',to_station:'Example South',departure_time:'10:00',arrival_time:'12:00',...extra});
// Source timestamps deliberately in the past relative to the test clock.
const observed=Date.parse('2020-06-02T12:00:00Z');
const plan=()=>({trainNumber:'700',category:'TEST',completePlan:true,planningSource:'Fictional archive',stops:[
 {station:'Example North',sequence:1,departure:{planning:{time:Date.parse('2031-06-10T07:56:00Z'),sourceTimestamp:observed}}},
 {station:'Example South',sequence:2,arrival:{planning:{time:Date.parse('2031-06-10T10:10:00Z'),sourceTimestamp:observed}}}
]});
test('unique matching planning compares actual boarding station, local date and category',()=>{
 const r=leg({created_at:'2020-06-01T12:00:00Z'}),p=plan();
 const o=observationFromPlans(r,[p]);assert.equal(o.departure_time,'09:56');assert.equal(o.arrival_time,'12:10');
 assert.equal(observationFromPlans(r,[p,p]),null);
 assert.equal(observationFromPlans(r,[{...p,category:'OTHER'}]),null);
 assert.equal(observationFromPlans(r,[{...p,completePlan:false}]),null);
 assert.equal(observationFromPlans({...r,created_at:'2020-06-03T12:00:00Z'},[p]),null);
 assert.equal(observationFromPlans({...r,from_station:'Ambiguous city'},[p]),null);
});
test('new planning invalidates old communication and uninitialized archive is explicitly unknown',async()=>{
 const r=leg({created_at:'2020-06-01T12:00:00Z',communication:{change_key:'old'}});
 const [changed]=await enrichChanges([r],async()=>[plan()]);assert.equal(changed.communication,null);assert.equal(changed.archive_available,true);
 const [unknown]=await enrichChanges([leg()],async()=>{throw Error('private backend unavailable');});assert.equal(unknown.observation,null);assert.equal(unknown.archive_available,false);
});
test('connection becomes impossible only at matching interchange and without assuming a backup',async()=>{
 const o={departure_date:'2031-06-10',departure_time:'10:00',arrival_date:'2031-06-10',arrival_time:'12:10',source:'Fictional verified source',observed_at:'2020-06-02T12:00:00Z',cancelled:false,connection_broken:false,backup_communicated:false};
 const first=leg({observation:o}),next=leg({leg_id:'next',sequence:2,from_station:'Example South',to_station:'Example East',departure_time:'12:05',arrival_time:'13:00'});
 const rows=await enrichChanges([first,next],async()=>[]);assert.equal(rows[0].observation.connection_broken,true);assert.equal(rows[0].observation.backup_communicated,false);
 const different=await enrichChanges([first,{...next,from_station:'Different station'}],async()=>[]);assert.equal(different[0].observation.connection_broken,false);
});
test('communication hash is deterministic and changes with every timing or connection status',()=>{
 const o={departure_date:'2031-06-10',departure_time:'10:00',arrival_date:'2031-06-10',arrival_time:'12:00',cancelled:false,connection_broken:false,backup_communicated:false};
 assert.equal(changeKey('fictional',o),changeKey('fictional',{...o}));
 assert.notEqual(changeKey('fictional',o),changeKey('fictional',{...o,departure_time:'09:56'}));
 assert.notEqual(changeKey('fictional',o),changeKey('fictional',{...o,connection_broken:true}));
});
