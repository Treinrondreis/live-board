import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSwissPlanning,swissPlanningRequest,swissQueryTime,createSwissPlanningSource} from './reisschema-swiss.mjs';
import {createPlanningSources} from './reisschema-feeds.mjs';
const leg={leg_id:'fictional',travel_date:'2031-06-10',arrival_date:'2031-06-10',train_number:'IC 700',from_station:'Example North',to_station:'Example South',departure_time:'10:00',arrival_time:'12:00'};
const meta={loadedAt:'2031-06-02T12:00:00Z',station:{name:'Example North',id:'ch:1:sloid:999001'},destination:{name:'Example South',id:'ch:1:sloid:999002'}};
function xml({mode='rail',number='700',depart='2031-06-10T10:00:00+02:00',arrive='2031-06-10T12:00:00+02:00',cancel='',calls='',repeat=false}={}){
 const event=`<StopEventResult><StopEvent><ThisCall><CallAtStop><StopPointRef>${meta.station.id}:1</StopPointRef><StopPointName><Text>Example North</Text></StopPointName><ServiceDeparture><TimetabledTime>${depart}</TimetabledTime><EstimatedTime>2031-06-10T11:00:00+02:00</EstimatedTime></ServiceDeparture></CallAtStop></ThisCall><OnwardCall><CallAtStop><StopPointRef>${meta.destination.id}:2</StopPointRef><StopPointName><Text>Example South</Text></StopPointName><ServiceArrival><TimetabledTime>${arrive}</TimetabledTime></ServiceArrival>${calls}</CallAtStop></OnwardCall><Service><JourneyRef>fictional-journey</JourneyRef><OperatingDayRef>2031-06-10</OperatingDayRef><Mode><PtMode>${mode}</PtMode><ShortName><Text>IC</Text></ShortName></Mode><TrainNumber>${number}</TrainNumber>${cancel}</Service></StopEvent></StopEventResult>`;
 return `<OJP><OJPResponse><ServiceDelivery><ResponseTimestamp>${meta.loadedAt}</ResponseTimestamp><OJPStopEventDelivery>${event}${repeat?event:''}</OJPStopEventDelivery></ServiceDelivery></OJPResponse></OJP>`;
}
test('official dated whole-journey matching uses planned times, category independent number and unique journey',()=>{
 const r=parseSwissPlanning(xml({repeat:true}),leg,meta);assert.equal(r.observation.departure_time,'10:00');assert.equal(r.observation.cancelled,false);
 assert.equal(parseSwissPlanning(xml({depart:'2031-06-10T09:55:00+02:00'}),leg,meta).observation.departure_time,'09:55');
 assert.equal(parseSwissPlanning(xml({number:'701'}),leg,meta).observation.train_number,'IC 701');
 assert.equal(parseSwissPlanning(xml({number:'701',depart:'2031-06-10T09:55:00+02:00'}),leg,meta).observation,undefined);
});
test('water service and quay are distinct; unnumbered boats need exact date/time pair',()=>{
 const boat={...leg,transport_type:'ferry',train_number:''};
 assert.equal(parseSwissPlanning(xml({mode:'water',number:''}),boat,meta).observation.departure_time,'10:00');
 assert.equal(parseSwissPlanning(xml(),boat,meta).observation,undefined);
 assert.equal(parseSwissPlanning(xml({mode:'water',number:'',depart:'2031-06-10T09:55:00+02:00'}),boat,meta).observation,undefined);
 assert.equal(parseSwissPlanning(xml(),leg,{...meta,station:{...meta.station,id:'ch:1:sloid:999003'}}).observation,undefined);
});
test('only explicit cancellation or unserved endpoint signals cancellation; missing/misdated data never does',()=>{
 assert.equal(parseSwissPlanning(xml({cancel:'<Cancelled>true</Cancelled>'}),leg,meta).observation.cancelled,true);
 assert.equal(parseSwissPlanning(xml({calls:'<NotServicedStop>true</NotServicedStop>'}),leg,meta).observation.cancelled,true);
 assert.equal(parseSwissPlanning(xml({calls:'<NoAlightingAtStop>true</NoAlightingAtStop>'}),leg,meta).observation,undefined);
 assert.equal(parseSwissPlanning(xml({depart:'2031-06-11T10:00:00+02:00'}),leg,meta).observation,undefined);
 assert.throws(()=>parseSwissPlanning(xml().replace(meta.loadedAt,'2031-06-01T12:00:00Z'),leg,meta));
 assert.equal(parseSwissPlanning(xml({depart:'2031-06-10T10:00:00'}),leg,meta).observation,undefined);
});
test('date request respects DST and escapes XML; no dossier or customer field in request',()=>{
 assert.equal(swissQueryTime({...leg,departure_time:'00:30',travel_date:'2026-10-25'}),'2026-10-24T22:00:00.000Z');
 assert.equal(swissQueryTime({...leg,departure_time:'00:30',travel_date:'2026-10-26'}),'2026-10-25T23:00:00.000Z');
 assert.equal(swissQueryTime({...leg,departure_time:'10:00',travel_date:'2026-10-26'}),'2026-10-26T08:00:00.000Z');
 assert.equal(swissQueryTime({...leg,departure_time:'10:00',travel_date:'2026-10-25'}),'2026-10-25T08:00:00.000Z');
 const req=swissPlanningRequest({...leg,dossier:'PRIVATE',transport_type:'ferry'},{...meta.station,name:'Example & <North>'},Date.parse(meta.loadedAt));
 assert.match(req,/<PtMode>water/);assert.match(req,/Example &amp; &lt;North&gt;/);assert.doesNotMatch(req,/PRIVATE/);
});
test('per-round station/date cache reuses the response and service failures stay neutral',async()=>{
 let calls=0;const source=createSwissPlanningSource({env:{OJP_API_KEY:'fictional'},clock:()=>Date.parse(meta.loadedAt),pause:async()=>{},fetcher:async()=>{calls++;return new Response(xml());}});
 const row={...leg,from_station_id:meta.station.id,to_station_id:meta.destination.id};
 assert.ok((await source.lookup(row)).observation);assert.ok((await source.lookup({...row,leg_id:'second'})).observation);assert.equal(calls,1);
 const unavailable=createSwissPlanningSource({env:{OJP_API_KEY:'fictional'},fetcher:async()=>new Response('',{status:429}),pause:async()=>{}});
 assert.equal((await unavailable.lookup(row)).observation,undefined);
});
test('ferry control flows through Swiss source only, never through national rail ZIPs',async()=>{
 const calls=[],source=createPlanningSources({env:{OJP_API_KEY:'fictional',REISSCHEMA_SNCF_ENABLED:'1'},clock:()=>Date.parse(meta.loadedAt),fetcher:async(url,options)=>{calls.push({url,body:options.body});return new Response(xml({mode:'water',number:'9'}));}});
 const row={...leg,transport_type:'ferry',train_number:'Boot 9',from_station_id:meta.station.id,to_station_id:meta.destination.id};
 const prepared=await source.prepare([row]),result=await prepared.lookup(row);
 assert.equal(result.observation.source,'Zwitserland OJP');assert.equal(calls.length,1);assert.match(calls[0].url,/\/ojp20$/);assert.match(calls[0].body,/<PtMode>water/);
});
