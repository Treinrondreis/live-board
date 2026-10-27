import assert from 'node:assert/strict';
import {iceRadar,estimateIcePosition} from './ice-radar.mjs';
const now=Date.UTC(2026,9,27,12),row={source:'NDOV',category:'ICE',number:'99901',rideId:'fixture',serviceDate:'2026-10-27',stationShortCode:'UT',observedAt:'Utrecht Centraal',to:'Voorbeeldstad',plannedTimestamp:now+60000,expectedTimestamp:now+120000,messageTimestamp:now,hasRealtime:true,delay:1};
assert.equal(iceRadar([row,{...row,messageTimestamp:now-1000,delay:99}],now).trains[0].delay,1);
assert.equal(iceRadar([{...row,messageTimestamp:now-16*60000}],now).trains[0].delay,null);
assert.equal(iceRadar([{...row,hasRealtime:false}],now).trains[0].delay,null);
assert.equal(iceRadar([row,{...row,stationShortCode:'AH',observedAt:'Arnhem Centraal',plannedTimestamp:now+3600000}],now).trains.length,1);
assert.equal(iceRadar(Array.from({length:12},(_,i)=>({...row,number:String(99900+i),rideId:`fixture-${i}`})),now).trains.length,12);
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

const journey=(number,start,end,abroad=false)=>({number,serviceDate:'2026-10-27',from:'Voorbeeld begin',to:'Voorbeeld eind',stops:[...(abroad?[{code:'DE',name:'Voorbeeld buitenland',country:'D',departure:start-3600000}]:[]),{code:'ASD',name:'Amsterdam Centraal',country:'NL',departure:start},{code:'UT',name:'Utrecht Centraal',country:'NL',arrival:end}]});
const fixtures=[journey('99101',now-7200000,now-3600001),journey('99102',now+3600001,now+7200000),journey('99103',now-7200000,now-3600000),journey('99104',now-600000,now+600000),journey('99105',now+3600000,now+7200000,true),journey('99106',now+1200000,now+3600000)];
const selected=iceRadar([],now,{journeys:fixtures});
assert.deepEqual(new Set(selected.trains.map(t=>t.number)),new Set(['99103','99104','99105','99106']));
assert.equal(selected.trains[0].number,'99104');
assert.equal(selected.trains.find(t=>t.number==='99105').phase,'approaching');
assert.equal(selected.trains.find(t=>t.number==='99106').phase,'departing');
assert.equal(selected.trains.find(t=>t.number==='99103').phase,'recent');
assert.equal(selected.trains[0].delay,null);
assert.equal(selected.trains[0].position.coordinates,null);
const historical={...row,departed:true,messageTimestamp:now-40*60000,plannedTimestamp:now-40*60000};
const history=iceRadar([historical],now).trains[0];
assert.equal(history.delay,1);assert.equal(history.delayKind,'historical');assert.equal(history.evidence.current,false);
const forecast=iceRadar([{...historical,departed:false}],now).trains[0];assert.equal(forecast.delay,null);
const pages=iceRadar(Array.from({length:17},(_,i)=>({...row,number:String(99900+i)})),now,{page:1});assert.equal(pages.trains.length,5);assert.equal(pages.total,17);

const mapJourneys=Array.from({length:14},(_,i)=>journey(String(99200+i),now-600000,now+(14-i)*60000));
const mapRows=mapJourneys.flatMap(j=>[{...row,number:j.number,stationShortCode:'ASD',observedAt:'Amsterdam Centraal',plannedTimestamp:now-600000,expectedTimestamp:now-600000,departed:true,delay:0,messageTimestamp:now-1000},{...row,number:j.number,stationShortCode:'UT',observedAt:'Utrecht Centraal',plannedTimestamp:j.stops[1].arrival,expectedTimestamp:j.stops[1].arrival,delay:0,messageTimestamp:now}]);
const allMap=iceRadar(mapRows,now,{journeys:mapJourneys});
assert.equal(allMap.trains.length,12);assert.equal(allMap.mapTrains.length,14);assert.equal(allMap.trains[0].number,'99213');
const target=allMap.mapTrains.at(-1).id;
const focused=iceRadar(mapRows,now,{journeys:mapJourneys,focus:target});assert.equal(focused.page,1);assert.ok(focused.trains.some(t=>t.id===target));
const delayed=iceRadar(mapRows.map(r=>r.stationShortCode==='UT'?{...r,delay:Number(r.number.slice(-2)),hasRealtime:r.number!=='99200'}:r),now,{journeys:mapJourneys,sort:'delay'});
assert.equal(delayed.trains[0].number,'99213');assert.equal(delayed.sort,'delay');
const lastPage=iceRadar(mapRows.map(r=>r.stationShortCode==='UT'?{...r,delay:Number(r.number.slice(-2)),hasRealtime:r.number!=='99200'}:r),now,{journeys:mapJourneys,sort:'delay',page:1});assert.equal(lastPage.trains.at(-1).number,'99200');assert.equal(lastPage.trains.at(-1).delay,null);
