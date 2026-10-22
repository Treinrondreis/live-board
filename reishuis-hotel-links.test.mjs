import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {hotelMatches,hotelStays,hotelTodoIndex,hotelRateChoice,hotelResolver} from './reishuis-hotel-links.mjs';
import {normalizeDossier,mergeDossier} from './reishuis-dossier.mjs';
import {createReishuisHandler} from './reishuis.mjs';
import {emptyReishuis} from './reishuis-store.mjs';
const hotels=[{id:'fixture-hotel',title:'Hotel Voorbeeld Amsterdam',titleShort:'Voorbeeld AMS',photos:[],rooms:[{key:'double',title:'Tweepersoonskamer',titleShort:'Double'}],apoRooms:[]},{id:'fixture-other',title:'Hotel Ander Voorbeeld',titleShort:'Ander',photos:[],rooms:[],apoRooms:[]}];
const todo={_key:'stay',done:true,title:'Voorbeeld AMS | Double',tag:'hotel',done:true,startDate:'2027-01-03',endDate:'2027-01-05',quantity:2};
const line={_key:'invoice',title:'03 jan.: Hotel Voorbeeld Amsterdam - Tweepersoonskamer',type:'product',quantity:1,price:240};
const source=()=>normalizeDossier({_id:'fixture-booking',todos:[todo],lines:[line]});
test('long/short hotel and room aliases plus Dutch date prefix link without altering money/status',()=>{
 const d=source(),before=structuredClone(d),m=hotelMatches(d,hotels)[d.todos[0].id];assert.equal(m.component.hotel,hotels[0].id);assert.equal(m.component.room,'double');assert.equal(m.component.line,d.lines[0].id);assert.equal(m.component.rooms,2);assert.deepEqual(d,before);
 for(const title of ['2027-01-03: Voorbeeld AMS | Double','3-1-2027: Voorbeeld AMS | Double','3 januari 2027: Voorbeeld AMS | Double']){const d=normalizeDossier({_id:'fixture',todos:[todo],lines:[{...line,title}]});assert.ok(hotelMatches(d,hotels)[d.todos[0].id].component);}
 const d2=normalizeDossier({_id:'fixture',todos:[todo],lines:[{...line,title:'Voorbeeld AMS | Double',date:'2027-01-03'}]});assert.ok(hotelMatches(d2,hotels)[d2.todos[0].id].component);
});
test('ambiguous names, dates, duplicate lines/tasks, room conflicts and occupied lines stay manual',()=>{
 for(const lines of [[{...line,title:'Voorbeeld AMS | Double'}],[{...line,date:'2027-01-04'}],[{...line,title:'04 jan.: Voorbeeld AMS | Double'}],[line,{...line,_key:'duplicate'}]]){const d=normalizeDossier({_id:'fixture',todos:[todo],lines});assert.equal(hotelMatches(d,hotels)[d.todos[0].id].component,undefined);}
 const d=source();assert.equal(hotelMatches(d,[...hotels,{...hotels[1],titleShort:'Voorbeeld AMS'}])[d.todos[0].id].component,undefined);
 const twins=normalizeDossier({_id:'fixture',todos:[todo,{...todo,_key:'duplicate'}],lines:[line]});assert.ok(Object.values(hotelMatches(twins,hotels)).every(m=>!m.component));
 const reserved=source();assert.equal(hotelMatches(reserved,hotels,{'removed-fixture':{line:reserved.lines[0].id}})[reserved.todos[0].id].component,undefined);
 const occupied=source();occupied.todos.push({id:'local-owner',component:{line:occupied.lines[0].id},tag:'option'});assert.equal(hotelMatches(occupied,hotels)[occupied.todos[0].id].component,undefined);
 const rooms=[{...hotels[0],rooms:[...hotels[0].rooms,{key:'single',title:'Eenpersoonskamer',titleShort:'Single'}]}];const mismatch=normalizeDossier({_id:'fixture',todos:[todo],lines:[{...line,title:'03 jan.: Voorbeeld AMS | Single'}]});assert.equal(hotelMatches(mismatch,rooms)[mismatch.todos[0].id].component,undefined);
});
test('minimal hotel index preserves identity and requested supplier reference, excluding notes and keyless/duplicate rows',()=>{
 const index=hotelTodoIndex([{...todo,description:'Fictieve privénotitie',supplierBookingNumber:'fixture-private'}, {title:'Zonder sleutel'},{...todo,_key:'duplicate'},{...todo,_key:'duplicate'}]);assert.equal(index.length,1);assert.equal(index[0].id,source().todos[0].id);assert.equal(index[0].description,undefined);assert.equal(index[0].supplierBookingNumber,'fixture-private');
});
test('hotel overview applies local moves, archives, dates, rooms and cancellation without duplicate old stays',()=>{
 const id=source().todos[0].id,b={id:'fixture-booking',index:'9901',name:'Fictieve Reiziger',status:'te verwerken',hotelTodos:hotelTodoIndex([todo])},state=emptyReishuis();
 assert.equal(hotelStays([b],state,hotels,hotels[0].id,'2027-01-04').stays[0].rooms,2);assert.equal(hotelStays([b],state,hotels,hotels[0].id,'2027-01-05').total,0);assert.equal(hotelStays([b],state,hotels,hotels[0].id,'2027-01-05','past').total,1);
 state.dossiers={[b.id]:{components:{[id]:{kind:'hotel',hotel:hotels[1].id,checkin:'2027-02-02',checkout:'2027-02-05',rooms:3}},reviews:[{id:'review-fixture',title:todo.title,review:true,archived:true,tag:'hotel'}]}};
 assert.equal(hotelStays([b],state,hotels,hotels[0].id,'2027-01-01').total,0);const moved=hotelStays([b],state,hotels,hotels[1].id,'2027-01-01');assert.equal(moved.total,1);assert.equal(moved.stays[0].checkin,'2027-02-02');assert.equal(moved.stays[0].rooms,3);
 const cancelled={...b,status:'geannuleerd'};assert.equal(hotelStays([cancelled],state,hotels,hotels[1].id,'2027-01-01').total,1);assert.equal(hotelStays([cancelled],state,hotels,hotels[1].id,'2027-01-01','cancelled').total,1);
 const ambiguous=[...hotels,{...hotels[1],titleShort:'Voorbeeld AMS'}];assert.equal(hotelStays([b],emptyReishuis(),ambiguous,hotels[0].id,'2027-01-01').uncertain,1);
 const many=Array.from({length:27},(_,i)=>({...b,id:'fixture-'+i,index:String(i)}));const second=hotelStays(many,emptyReishuis(),hotels,hotels[0].id,'2027-01-01','upcoming',1);assert.equal(second.total,27);assert.equal(second.stays.length,2);assert.equal(second.pages,2);
});
test('overview and automatic local links require role, origin, CSRF, membership, source/revision; GET never writes',async()=>{
 let allowed=false,state=emptyReishuis(),revision=0,reads=0,writes=0,cache;const d=source(),list=[{id:'fixture-booking',name:'Fictieve Reiziger',index:'9901',status:'te verwerken',hotelTodos:hotelTodoIndex([todo])}];
 const h=createReishuisHandler({origin:'https://example.test',clock:()=>Date.parse('2027-01-01'),authenticate:async()=>allowed,actor:async()=> 'fixture-user',read:async()=>({state:structuredClone(state),revision}),write:async(s,r)=>{assert.equal(r,revision);writes++;state=s;return ++revision;},readSnapshot:async()=>cache,writeSnapshot:async s=>{cache=s;},fetchBookings:async()=>{reads++;return list;},fetchHotels:async()=>{reads++;return hotels;},readDossier:async()=>null,writeDossier:async()=>{},fetchDossier:async()=>d});
 const request=async(path,method='GET',data,headers={})=>{const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;req.headers={cookie:'tr_google_session=fixture',...headers};let status,body;const responseHeaders={};await h(req,{setHeader:(k,v)=>responseHeaders[k]=v,writeHead:(s,hs)=>{status=s;Object.assign(responseHeaders,hs);},end:v=>{body=v;}},new URL('https://example.test/seinhuis/reishuis'+path));return {status,headers:responseHeaders,data:JSON.parse(body)};};
 for(const path of ['/api/hotel-stays?id=fixture-hotel','/api/dossier?id=fixture-booking','/reishuis-hotel-links.mjs'])assert.equal((await request(path)).status,403);assert.equal(reads,0);allowed=true;
 const overview=await request('/api/hotel-stays?id=fixture-hotel');assert.equal(overview.status,200);assert.equal(overview.headers['Cache-Control'],'private, no-store');assert.equal(overview.data.stays[0].index,'9901');assert.equal(writes,0);assert.equal((await request('/api/hotel-stays?id=fixture-hotel&page=-1')).status,400);assert.equal((await request('/api/hotel-stays?id=missing')).status,404);
 const api=await request('/api/state');assert.equal(api.data.bookings[0].hotelTodos,undefined);const dossier=await request('/api/dossier?id=fixture-booking');assert.ok(dossier.data.dossier.todos[0].hotelMatch.component);assert.equal(writes,0);
 const input={action:'match-hotels',booking:'fixture-booking',sourceVersion:dossier.data.sourceVersion,revision:0,components:{forged:'never trusted'}};const headers={origin:'https://example.test','content-type':'application/json','x-reishuis-csrf':api.data.csrf};
 assert.equal((await request('/api/change','POST',input,{})).status,403);assert.equal((await request('/api/change','POST',input,{...headers,origin:'https://evil.test'})).status,403);assert.equal((await request('/api/change','POST',{...input,sourceVersion:'stale'},headers)).status,409);assert.equal((await request('/api/change','POST',{...input,booking:'missing'},headers)).status,400);assert.equal(writes,0);
 assert.equal((await request('/api/change','POST',input,headers)).status,200);assert.equal(state.dossiers['fixture-booking'].components[d.todos[0].id].line,d.lines[0].id);assert.equal(state.dossiers['fixture-booking'].components.forged,undefined);assert.equal(state.dossiers['fixture-booking'].lines,undefined);assert.equal(state.dossiers['fixture-booking'].todos,undefined);assert.equal(writes,1);assert.equal((await request('/api/change','POST',input,headers)).status,409);assert.equal((await request('/api/change','POST',{...input,revision:1},headers)).status,200);assert.equal(writes,1,'idempotent no-op');
});


test('invoice stay ranges, quantity prefixes and breakfast suffixes link the right short-name room',()=>{
 const catalog=[{...hotels[0],rooms:[...hotels[0].rooms,{key:'twin',title:'Tweepersoonskamer met losse bedden',titleShort:'Twin'}]}];
 for(const title of ['03 jan. - 05 jan.: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer (incl. ontbijt)','3 januari – 5 januari: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer (inclusief ontbijt)','2027-01-03 — 2027-01-05: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer']){
  const d=normalizeDossier({_id:'fixture',todos:[todo],lines:[{...line,title},{...line,_key:'twin',title:'03 jan. - 05 jan.: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer met losse bedden (incl. ontbijt)'}]});const m=hotelMatches(d,catalog)[d.todos[0].id];assert.equal(m.component.line,d.lines[0].id);assert.equal(m.component.room,'double');
 }
 for(const title of ['03 jan. - 06 jan.: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer','03 jan. - 31 feb.: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer']){const d=normalizeDossier({_id:'fixture',todos:[todo],lines:[{...line,title}]});assert.equal(hotelMatches(d,catalog)[d.todos[0].id].component,undefined);}
 const cross=normalizeDossier({_id:'fixture',todos:[{...todo,startDate:'2027-12-30',endDate:'2028-01-02'}],lines:[{...line,title:'30 dec. - 2 jan.: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer (incl. ontbijt)'}]});assert.ok(hotelMatches(cross,catalog)[cross.todos[0].id].component);
});


test('an unlinked local date edit still resolves the original invoice period without reverting the local stay',()=>{
 const original=normalizeDossier({_id:'fixture',todos:[todo],lines:[{...line,title:'3 jan. - 5 jan.: Hotel Voorbeeld Amsterdam - 1x Tweepersoonskamer (incl. ontbijt)'}]}),id=original.todos[0].id,local={todos:{[id]:{endDate:'2027-01-06',_edited:['endDate']}}},merged=mergeDossier(original,local);assert.equal(hotelMatches(merged,hotels)[id].component,undefined);const match=hotelMatches(merged,hotels,{},original)[id];assert.equal(match.component.line,original.lines[0].id);assert.equal(match.component.checkout,'2027-01-06');assert.equal(original.todos[0].endDate,'2027-01-05');
});


test('automatic rate choice fills only a unique compatible variant and preserves explicit selections',()=>{
 const component={kind:'hotel',hotel:'fixture-hotel',room:'double'},h=[{id:'fixture-hotel',rooms:[{key:'double',apoRoom:{docId:'fixture-hotel',path:'apoRooms.rate'}}],apoRooms:[{key:'rate',prices:[{source:'fixture-one',boardType:'RO'},{source:'fixture-one',boardType:'RO'}]}]}];assert.equal(hotelRateChoice(component,h).provider,'fixture-one');assert.equal(hotelRateChoice({...component,board:'BB'},h).board,'BB');assert.equal(hotelRateChoice({...component,board:'BB'},h).provider,undefined);
 h[0].apoRooms[0].prices.push({source:'fixture-two',boardType:'RO'});assert.equal(hotelRateChoice(component,h).provider,undefined);assert.equal(hotelRateChoice({...component,provider:'fixture-one'},h).board,'RO');
});

test('default includes future and ongoing stays; checkout day is past; cancellation is explicit',()=>{
 const b={id:'fixture-period',index:'9990',name:'Fictieve Reiziger',status:'te verwerken',hotelTodos:hotelTodoIndex([todo])},state=emptyReishuis();
 for(const today of ['2027-01-01','2027-01-03','2027-01-04']){const r=hotelStays([b],state,hotels,hotels[0].id,today);assert.equal(r.total,1);assert.equal(r.stays[0].cancelled,false);assert.equal(hotelStays([b],state,hotels,hotels[0].id,today,'past').total,0);}
 assert.equal(hotelStays([b],state,hotels,hotels[0].id,'2027-01-05','past').total,1);
 for(const status of ['geannuleerd','Geannuleerd door klant','cancelled','canceled']){const cancelled={...b,status};assert.equal(hotelStays([cancelled],state,hotels,hotels[0].id,'2027-01-01').total,1);assert.equal(hotelStays([cancelled],state,hotels,hotels[0].id,'2027-01-01','cancelled').stays[0].cancelled,true);}
});

test('hotel overview only shows effectively booked tasks and warns on the trip status',()=>{
 const b={id:'fixture-booked',index:'9990',name:'Fictieve Reiziger',status:'wacht op reactie klant',hotelTodos:hotelTodoIndex([todo])},state=emptyReishuis(),id=b.hotelTodos[0].id;
 const read=()=>hotelStays([b],state,hotels,hotels[0].id,'2027-01-01');assert.match(read().stays[0].attention,/Wacht op reactie klant/);
 state.dossiers={[b.id]:{todos:{[id]:{status:'pending',_edited:['status']}}}};assert.equal(read().total,0);state.dossiers[b.id].todos[id].status='done';assert.equal(read().total,1);
 b.status='geannuleerd';assert.equal(read().total,1);const cancelled=hotelStays([b],state,hotels,hotels[0].id,'2027-01-01','cancelled').stays[0];assert.equal(cancelled.cancelled,true);assert.match(cancelled.attention,/geannuleerd/);
 const pending={...b,status:'te verwerken',hotelTodos:hotelTodoIndex([{...todo,done:false,status:'pending'}])};assert.equal(hotelStays([pending],{},hotels,hotels[0].id,'2027-01-01').total,0);
});

test('annotation and translated city variants match only a unique hotel and resolver reuses its index',()=>{let reads=0;const h={id:'fixture',get title(){reads++;return 'Voorbeeld Hotel Boedapest [T]';},titleShort:'Voorbeeld Budapest {CHECK PRIJS}',rooms:[]},resolve=hotelResolver([h]);for(let i=0;i<1000;i++)assert.equal(resolve('Voorbeeld Budapest | Double')[0].id,h.id);assert.equal(reads,1);assert.equal(resolve('Fr 01-01 | Voorbeeld Budapest (Teldar) | Double')[0].id,h.id);assert.equal(hotelResolver([h,{...h,id:'other'}])('Voorbeeld Budapest | Double').length,2);});
test('known untagged hotel tasks join the overview but unrelated untagged tasks do not',()=>{const b={id:'fixture',index:'F-1',status:'te verwerken',hotelTodos:hotelTodoIndex([{...todo,tag:undefined},{_key:'other',title:'Documenten controleren',done:true}]),hotelFinancialLines:[]},r=hotelStays([b],{},hotels,'fixture-hotel','2027-01-01');assert.equal(r.stays.length,1);assert.equal(b.hotelTodos[0].tag,'');});
