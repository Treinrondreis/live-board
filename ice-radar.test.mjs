import assert from 'node:assert/strict';
import {iceRadar,estimateIcePosition} from './ice-radar.mjs';
const now=Date.UTC(2026,9,27,12),row={source:'NDOV',category:'ICE',number:'99901',rideId:'fixture',serviceDate:'2026-10-27',stationShortCode:'UT',observedAt:'Utrecht Centraal',to:'Voorbeeldstad',plannedTimestamp:now+60000,expectedTimestamp:now+120000,messageTimestamp:now,hasRealtime:true,delay:1};
assert.equal(iceRadar([row,{...row,messageTimestamp:now-1000,delay:99}],now).trains[0].delay,1);
assert.equal(iceRadar([{...row,messageTimestamp:now-16*60000}],now).trains[0].delay,null);
assert.equal(iceRadar([{...row,hasRealtime:false}],now).trains[0].delay,null);
assert.equal(iceRadar([row,{...row,stationShortCode:'AH',observedAt:'Arnhem Centraal',plannedTimestamp:now+3600000}],now).trains.length,1);
assert.equal(iceRadar(Array.from({length:12},(_,i)=>({...row,rideId:`fixture-${i}`})),now).trains.length,8);
assert.equal(iceRadar([{...row,source:'DB'},{...row,category:'IC'}],now).trains.length,0);
const before={...row,stationShortCode:'ASD',observedAt:'Amsterdam Centraal',plannedTimestamp:now-600000,expectedTimestamp:now-600000,departed:true};
const after={...row,expectedTimestamp:now+600000};
const position=estimateIcePosition([before,after],now);
assert.equal(position.kind,'estimated');
assert.ok(Math.abs(position.coordinates[0]-5.0053)<0.00001);
for(const change of [{cancelled:true},{hasRealtime:false},{notBoardable:true},{messageTimestamp:now-16*60000}]){
 assert.equal(estimateIcePosition([before,{...after,...change}],now).kind,'station');
}
assert.equal(estimateIcePosition([{...before,departed:false},after],now).kind,'station');
assert.equal(estimateIcePosition([before,{...after,expectedTimestamp:now-600000}],now).kind,'station');
assert.equal(estimateIcePosition([],now).coordinates,null);
console.log('ICE radar: deduplication, freshness, unknown delay, limit and source filtering passed');
