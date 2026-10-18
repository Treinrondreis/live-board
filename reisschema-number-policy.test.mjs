import test from 'node:test';
import assert from 'node:assert/strict';
import {numberAssessment,reservationStatus,applyNumberPolicy,controlPolicy,manualControlAttention} from './reisschema-number-policy.mjs';

test('missing coverage is neutral; structured and legacy conflicts remain attention items',()=>{
 assert.equal(manualControlAttention({control:{outcome:'manual',reason:'Geen volledige dekking'}}),false);
 assert.equal(manualControlAttention({control:{outcome:'manual',reason:'Bronnen spreken elkaar tegen'}}),true);
 assert.equal(manualControlAttention({control:{outcome:'manual',sources:[JSON.stringify({kind:'planning-control',attention:true})]}}),true);
 assert.equal(manualControlAttention({control:{outcome:'manual',reason:'Bronnen spreken elkaar tegen',sources:[JSON.stringify({kind:'planning-control',attention:false})]}}),false);
});
import {assess} from './reisschema-control.mjs';
import {changeKey} from './reisschema-changes.mjs';
const now=Date.parse('2031-06-02T12:00:00Z');
const leg={leg_id:'fictional',train_number:'ICE 700',travel_date:'2031-06-10',arrival_date:'2031-06-10',departure_time:'10:00',arrival_time:'12:00'};
const o={departure_date:leg.travel_date,arrival_date:leg.arrival_date,departure_time:'10:00',arrival_time:'12:00',cancelled:false,connection_broken:false,backup_communicated:false,source:'NDOV IFF',observed_at:new Date(now).toISOString(),train_number:'ICE 701'};
const result=observation=>({observation,sources:[JSON.stringify({source:observation.source,downloaded_at:new Date(now).toISOString()})]});
test('operational defaults and explicit overrides distinguish reserved and unreserved trains',()=>{
 for(const kind of ['ICE','RJ','ECE','FR','EC','EuroCity'])assert.equal(reservationStatus({...leg,train_number:kind+' 700'}),'reserved');
 for(const kind of ['IC','SPR','RE'])assert.equal(reservationStatus({...leg,train_number:kind+' 700'}),'unreserved');
 assert.equal(reservationStatus(leg,{reservation_status:'unreserved'}),'unreserved');
});
test('same numeric number with another designation is accepted',()=>{
 const observation={...o,train_number:'RE 700'};
 assert.equal(numberAssessment(leg,observation).notify,false);assert.equal(assess(leg,observation).changed,false);
});
test('reserved number change is a specific durable notification with old and current number',()=>{
 const r=applyNumberPolicy(leg,result(o),now),policy=controlPolicy({control:{sources:r.sources}});
 assert.equal(assess(leg,r.observation).reservationReview,true);assert.equal(assess(leg,r.observation).draftRequired,true);
 assert.match(r.reason,/Was ICE 700; nu ICE 701/);assert.equal(policy.notification_required,true);
 assert.notEqual(changeKey(leg.leg_id,o,leg),changeKey(leg.leg_id,{...o,train_number:'ICE 702'},leg));
});
test('Nightjet, TGV and unreserved changes remain informational',()=>{
 for(const kind of ['NJ','TGV','TGV Lyria','SPR']){
  const r={...leg,train_number:kind+' 700'},observation={...o,train_number:kind+' 701'};
  assert.equal(numberAssessment(r,observation).notify,false);assert.equal(assess(r,observation).changed,false);
  assert.equal(changeKey(r.leg_id,observation,r),changeKey(r.leg_id,{...observation,train_number:kind+' 702'},r));
 }
});
test('NDOV Nightjet needs additional DB evidence, separately from a completed time check',()=>{
 const row={...leg,train_number:'NJ 700'},observation={...o,train_number:'NJ 701'};
 const p=r=>controlPolicy({control:{sources:r.sources}});
 assert.equal(p(applyNumberPolicy(row,result(observation),now)).extra_db_required,true);
 const verified={...row,db_verification:{...observation,observed_at:new Date(now).toISOString()}};
 assert.equal(p(applyNumberPolicy(verified,result(observation),now)).extra_db_required,false);
 assert.equal(p(applyNumberPolicy(verified,result({...observation,arrival_time:'12:01'}),now)).extra_db_required,true);
 assert.equal(p(applyNumberPolicy(verified,result(observation),now+4*3600000+1)).extra_db_required,true);
});
