import test from 'node:test';
import assert from 'node:assert/strict';
import {createIrailSource,parseIrailVehicle} from './reisschema-irail.mjs';
const now=Date.parse('2031-06-02T10:00:00Z');
const leg={leg_id:'fictional',travel_date:'2031-06-11',train_number:'IC 700',departure_time:'23:50',arrival_time:'00:30',from_station:'Example Noord',to_station:'Example Zuid'};
const meta={loadedAt:new Date(now).toISOString(),queryDate:leg.travel_date};
const stop=(name,time,extra={})=>({station:name,scheduledDepartureTime:String(Date.parse(time)/1000),scheduledArrivalTime:String(Date.parse(time)/1000),departureCanceled:'0',arrivalCanceled:'0',...extra});
const vehicle=()=>({timestamp:now/1000,vehicle:'BE.NMBS.IC700',stops:{stop:[stop('Example Noord','2031-06-11T21:50:00Z',{departureDelay:'600'}),stop('Example Zuid','2031-06-11T22:30:00Z')]}});
test('planned times and Brussels midnight retained, delay never added',()=>{
 const result=parseIrailVehicle(vehicle(),leg,meta);assert.equal(result.observation.departure_time,'23:50');assert.equal(result.observation.arrival_date,'2031-06-12');assert.equal(result.observation.arrival_time,'00:30');
});
test('wrong number, wrong date, ambiguous or reversed stops never accepted',()=>{
 for(const data of [{...vehicle(),vehicle:'BE.NMBS.IC701'},{...vehicle(),stops:{stop:[...vehicle().stops.stop,vehicle().stops.stop[0]]}},{...vehicle(),stops:{stop:vehicle().stops.stop.reverse()}}])assert.equal(parseIrailVehicle(data,leg,meta).observation,undefined);
 assert.equal(parseIrailVehicle(vehicle(),{...leg,travel_date:'2031-06-12'},meta).observation,undefined);
});
test('explicit cancellation and required scheduled fields',()=>{
 const data=vehicle();data.stops.stop[1].arrivalCanceled='1';assert.equal(parseIrailVehicle(data,leg,meta).observation.cancelled,true);
 delete data.stops.stop[0].scheduledDepartureTime;assert.equal(parseIrailVehicle(data,leg,meta).observation,undefined);
});
test('one station, board and vehicle request shared across dossiers; no customer ids transmitted',async()=>{
 const calls=[];
 const source=createIrailSource({clock:()=>now,pause:async()=>{},fetcher:async url=>{
  calls.push(url);const path=new URL(url).pathname;
  const body=path.endsWith('stations')?{timestamp:now/1000,station:[{id:'fictional-station',name:'Example Noord'}]}:path.endsWith('liveboard')?{timestamp:now/1000,departures:{departure:[{vehicle:'BE.NMBS.IC700'}]}}:vehicle();
  return new Response(JSON.stringify(body),{headers:{'cache-control':'max-age=60'}});
 }});
 assert.ok((await source.lookup(leg)).observation);assert.ok((await source.lookup({...leg,leg_id:'another-private-id'})).observation);assert.equal(calls.length,3);assert.ok(calls.every(c=>!c.includes('fictional')||c.includes('fictional-station')));assert.ok(calls.every(c=>!c.includes('another-private-id')));
});
test('429 stops further requests rather than retrying aggressively; missing result is not cancellation',async()=>{
 let calls=0;const source=createIrailSource({clock:()=>now,pause:async()=>{},fetcher:async()=>{calls++;return new Response('',{status:429});}});
 assert.equal((await source.lookup(leg)).observation,undefined);assert.equal((await source.lookup(leg)).observation,undefined);assert.equal(calls,1);
});
test('old API response cannot count as a fresh check',async()=>{
 const source=createIrailSource({clock:()=>now,pause:async()=>{},fetcher:async()=>new Response(JSON.stringify({timestamp:now/1000-14401,station:[]}))});
 assert.equal((await source.lookup(leg)).observation,undefined);
});
