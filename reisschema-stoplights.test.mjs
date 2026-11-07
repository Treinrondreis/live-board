import test from 'node:test';
import assert from 'node:assert/strict';
import {endpointStatus,journeyTable} from './reisschema-table.mjs';
import {numberAssessment} from './reisschema-number-policy.mjs';
const row={train_number:'ICE 700',travel_date:'2031-06-01',arrival_date:'2031-06-01',departure_time:'10:00',arrival_time:'14:00',from_station:'Station A',to_station:'Station B'};
test('endpoint evidence does not invent arrival coverage',()=>{
 const r={...row,control:{checked_at:'2031-05-30T10:00:00Z',sources:[JSON.stringify({source:'NDOV IFF',compared_departure_date:row.travel_date,compared_departure_time:'10:00'})]}};
 assert.equal(endpointStatus(r,'departure').state,'green');assert.equal(endpointStatus(r,'arrival').state,'orange');
 assert.match(endpointStatus(r,'departure').title,/NDOV IFF/);
});
test('independent sources and changed dates are distinguished',()=>{
 const r={...row,control:{checked_at:'2031-05-30T10:00:00Z',sources:[JSON.stringify({source:'NDOV IFF',compared_departure_date:row.travel_date,compared_departure_time:'10:00'}),JSON.stringify({source:'Patrick GTFS',compared_arrival_date:row.arrival_date,compared_arrival_time:'14:04'})]}};
 assert.equal(endpointStatus(r,'departure').state,'green');assert.equal(endpointStatus(r,'arrival').state,'red');
 assert.match(endpointStatus(r,'arrival').title,/Patrick GTFS/);
 const html=journeyTable([r]);assert.match(html,/check-light green/);assert.match(html,/check-light red/);assert.match(html,/<details class="control-details">/);
});
test('regional line and trip numbers are not compared as train changes',()=>{
 for(const [a,b] of [['RE 7','RE 4756'],['RS32 (30952)','RS 32'],['S 1','S 1001']])assert.equal(numberAssessment({train_number:a,reservation_status:'reserved'},{train_number:b}).changed,false);
 assert.equal(numberAssessment({train_number:'RE 7',trip_number:'4756'},{train_number:'RE 7',trip_number:'4757'}).changed,true);
 assert.equal(numberAssessment(row,{train_number:'ICE 701'}).notify,true);
});
test('unverified planned times are never a green light; explicit negative evidence wins',()=>{
 assert.equal(endpointStatus({...row,observation:{departure_time:'10:00',departure_date:row.travel_date}},'departure').state,'orange');
 assert.equal(endpointStatus({...row,endpoint_checks:{departure:{checked:false}},control:{outcome:'checked'},observation:{departure_time:'10:00',departure_date:row.travel_date}},'departure').state,'orange');
});
