import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {normalizeHotel,fetchHotels,createHotelCache,hotelWithLinkedRates} from './reishuis-hotels.mjs';
import {createReishuisHandler} from './reishuis.mjs';
const fixture={_id:'fixture-hotel',title:'Voorbeeldhotel',description:[{children:[{text:'Fictieve omschrijving'}]}],photos:['https://evil.test/photo'],rooms:[{title:'Tweepersoonskamer',guests:2,prices:[{price:'120'}]}],apoRooms:[{_key:'fixture-room',title:'Standaard',prices:[{date:'2026-11-01',price:123,source:'Fictieve leverancier',lastUpdate:'2026-10-17',boardType:'RO'}]}]};
test('hotel import uses fixed GET projection, safe photos, pagination and draft overrides',async()=>{
 let calls=0;const hotels=await fetchHotels({config:{project:'il9cyh3m',dataset:'production',token:'fixture'},fetcher:async(u,o)=>{assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(u.searchParams.get('perspective'),'raw');assert.doesNotMatch(u.searchParams.get('query'),/history|secret|tourBooking|token|jobId/);calls++;return {ok:true,json:async()=>({result:calls===1?Array.from({length:25},(_,i)=>({...fixture,_id:'fixture-'+String(i).padStart(2,'0')})):[{...fixture,_id:'drafts.fixture-00',title:'Conceptvoorbeeld'}]})};}});assert.equal(calls,2);assert.equal(hotels.length,25);assert.equal(hotels[0].title,'Conceptvoorbeeld');assert.deepEqual(hotels[0].photos,[]);assert.equal(hotels[0].description,'Fictieve omschrijving');assert.equal(hotels[0].apoRooms[0].prices[0].price,123);
});
test('hotel cache shares concurrent reads and preserves last complete result on failure',async()=>{
 let calls=0,now=0;const get=createHotelCache({clock:()=>now,fetchHotels:async()=>{calls++;if(calls>1)throw Error('fixture failure');return [normalizeHotel(fixture)];}});await Promise.all([get(),get(),get()]);assert.equal(calls,1);now=400000;assert.equal((await get()).hotels.length,1);await new Promise(r=>setImmediate(r));assert.equal((await get()).hotels.length,1);
});
test('hotel APIs and module are role protected before source access; no public asset URLs',async()=>{
 let allowed=false,reads=0;const handler=createReishuisHandler({authenticate:async()=>allowed,fetchHotels:async()=>{reads++;return [normalizeHotel(fixture)];}});
 const request=async path=>{let status,body;const headers={},req=Readable.from([]);req.method='GET';req.headers={};await handler(req,{setHeader:(k,v)=>headers[k]=v,writeHead:(s,h)=>{status=s;Object.assign(headers,h);},end:v=>body=v},new URL('https://example.test/seinhuis/reishuis'+path));return {status,headers,body};};
 for(const path of ['/api/hotels','/api/hotel?id=fixture-hotel','/api/hotel-photo?id=fixture-hotel&index=0','/reishuis-hotels-ui.js'])assert.equal((await request(path)).status,403);assert.equal(reads,0);allowed=true;const list=await request('/api/hotels');assert.equal(list.status,200);assert.equal(list.headers['Cache-Control'],'private, no-store');assert.equal(JSON.parse(list.body).hotels[0].apoRooms[0].prices,undefined);assert.equal(JSON.parse(list.body).hotels[0].description,undefined);const detail=await request('/api/hotel?id=fixture-hotel');assert.equal(detail.status,200);assert.doesNotMatch(detail.body,/https:|secret|Authorization/);assert.equal((await request('/api/hotel?id=missing')).status,404);
});

test('room links resolve only matching APO keys and report missing links',()=>{const h=normalizeHotel({...fixture,rooms:[{title:'Kamer A',apoRoom:{docId:'fixture-hotel',path:'apoRooms.fixture-room'}},{title:'Kamer B',apoRoom:{docId:'missing',path:'apoRooms.missing'}}]});const result=hotelWithLinkedRates(h,[h]);assert.deepEqual(result.apoRooms[0].roomTitles,['Kamer A']);assert.deepEqual(result.unresolved,['Kamer B']);});

test('legacy room identities survive source reordering',()=>{const a={title:'Fictieve kamer A',guests:2},b={title:'Fictieve kamer B',guests:1};const first=normalizeHotel({...fixture,rooms:[a,b]}),next=normalizeHotel({...fixture,rooms:[b,a]});assert.equal(first.rooms[0].key,next.rooms[1].key);assert.notEqual(first.rooms[0].key,first.rooms[1].key);});
