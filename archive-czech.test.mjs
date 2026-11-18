import test from 'node:test';
import assert from 'node:assert/strict';
import {czechArchiveRows} from './archive-czech.mjs';

const now=Date.parse('2026-11-18T12:00:00Z');
const call={page:'praha',station:'Praha hlavní nádraží',trip_id:'fictional-rj',date:'2026-11-18',
  stop_id:'czptt:stop:CZ:1',stop_sequence:3,plannedTimestamp:now+3600000,platform_code:'2',
  trip_short_name:'RJ 123',trip_headsign:'Fictional destination',future_route:['Fictional via','Fictional destination']};
const update={trip_id:call.trip_id,service_day:'20261118',version:'v1',observed:now-30*60000,
  relationship:'SCHEDULED',stops:[{stopSequence:3,stopId:call.stop_id+':platform:2',departure:{delay:300}}]};
const fixture=(updates=[update])=>({plan:{version:'v1',rows:[call]},updates});

test('keeps timetable departures and future stops when no delayed measurement exists',()=>{
  const [row]=czechArchiveRows(fixture([]),now);
  assert.equal(row.hasRealtime,false);
  assert.equal(row.delay,null);
  assert.deepEqual(row.futureRoute,call.future_route);
  assert.equal(row.to,call.trip_headsign);
});

test('requires the same dated trip, timetable version, station and sequence',()=>{
  assert.equal(czechArchiveRows(fixture(),now)[0].delay,5);
  for(const mutation of [{version:'other'},{service_day:'20261117'},{trip_id:'other'},
    {observed:now-91*60000},{observed:now+1000},
    {stops:[{stopSequence:4,stopId:call.stop_id,departure:{delay:300}}]},
    {stops:[{stopSequence:3,stopId:'other',departure:{delay:300}}]}]){
    const [row]=czechArchiveRows(fixture([{...update,...mutation}]),now);
    assert.equal(row.hasRealtime,false);
  }
});

test('does not turn an arrival observation or a missing update into a departure delay',()=>{
  const [row]=czechArchiveRows(fixture([{...update,stops:[{stopSequence:3,stopId:call.stop_id,arrival:{delay:900}}]}]),now);
  assert.equal(row.delay,null);
  assert.equal(row.cancelled,false);
});

test('the newest observation can clear a cancellation and zero delay stays a valid measurement',()=>{
  const old={...update,relationship:'CANCELED',observed:now-40*60000};
  const fresh={...update,stops:[{stopSequence:3,stopId:call.stop_id,departure:{delay:0}}]};
  const [row]=czechArchiveRows(fixture([fresh,old]),now);
  assert.equal(row.cancelled,false);
  assert.equal(row.delay,0);
  assert.equal(row.hasRealtime,true);
  assert.equal(czechArchiveRows(fixture([old]),now)[0].cancelled,true);
});
