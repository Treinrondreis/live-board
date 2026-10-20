import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hotelFinancialIndex,hotelTodoIndex,hotelStays} from './reishuis-hotel-links.mjs';
import {normalizeDossier} from './reishuis-dossier.mjs';
import {normalizeHotel} from './reishuis-hotels.mjs';
const h=normalizeHotel({_id:'fixture-hotel',title:'Voorbeeldhotel',titleShort:'Voorbeeld',bookingPriceSource:'cms',rooms:[{_key:'double',title:'Standaard',titleShort:'Double',prices:[{price:'120'}]}]});
const todo={_key:'stay',done:true,title:'Voorbeeld | Double',tag:'hotel',done:true,startDate:'2027-03-05',endDate:'2027-03-08',quantity:2,supplierBookingNumber:'fixture-reservation'},line={_key:'invoice',title:'5 mrt. - 8 mrt.: Voorbeeldhotel | Double',quantity:2,price:210,costs:199};
const booking=()=>({id:'fixture-booking',index:'F-9001',name:'Fictieve Reiziger',status:'te verwerken',hotelTodos:hotelTodoIndex([todo]),hotelFinancialLines:hotelFinancialIndex([line])});
const get=(b=booking(),s={})=>hotelStays([b],s,[h],h.id,'2027-01-01');
test('financial index preserves stable dossier identities and minimal fields only',()=>{
 const d=normalizeDossier({_id:'fixture-booking',lines:[line]});assert.equal(hotelFinancialIndex([line])[0].id,d.lines[0].id);assert.equal(hotelFinancialIndex([{...line,_key:undefined}]).length,0);assert.equal(hotelFinancialIndex([line,line]).length,0);const index=hotelFinancialIndex([{...line,subTitle:'Fictieve notitie',email:'not-an-email',price:'210',costs:'199'}])[0];assert.equal(index.subTitle,undefined);assert.equal(index.email,undefined);assert.equal(index.price,210);
});
test('actual is invoice costs times invoice quantity; current uses every night and room, without writing',()=>{
 const b=booking(),original=structuredClone(b),state={},result=get(b,state),r=result.stays[0];assert.equal(r.calculated,420);assert.equal(r.actual,398);assert.equal(r.current,720);assert.equal(r.roomNights,6);assert.equal(r.supplierBookingNumber,'fixture-reservation');assert.equal(result.months['2027-03'].roomNights,6);assert.equal(result.summary.bookings,1);assert.equal(result.summary.averageActual,66.33);assert.deepEqual(b,original);assert.deepEqual(state,{});
 const local={dossiers:{[b.id]:{lines:{[b.hotelFinancialLines[0].id]:{costs:180,_edited:['costs']}}}}};assert.equal(get(b,local).stays[0].actual,360);assert.equal(get(b,local).stays[0].calculated,420);
});
test('unknown costs stay unknown, explicit zero remains zero, missing calendar never becomes zero',()=>{
 let b=booking();b.hotelFinancialLines[0].costs=null;assert.equal(get(b).stays[0].actual,null);assert.equal(get(b).summary.averageActual,null);b.hotelFinancialLines[0].costs=0;assert.equal(get(b).stays[0].actual,0);assert.equal(get(b).summary.averageActual,0);const missing=structuredClone(h);missing.rooms[0].contractRates=[{price:'0',available:[]}];const r=hotelStays([b],{},[missing],h.id,'2027-01-01').stays[0];assert.equal(r.current,null);assert.ok(r.priceReason);
});
test('ambiguous lines and duplicate claims cannot display guessed or double-counted money',()=>{
 const b=booking();b.hotelFinancialLines.push({...b.hotelFinancialLines[0],id:'fixture-duplicate'});const r=get(b).stays[0];assert.equal(r.actual,null);assert.equal(r.calculated,null);assert.equal(r.current,null);assert.equal(r.needsReview,true);
 const clean=booking(),id=clean.hotelTodos[0].id,component={kind:'hotel',hotel:h.id,room:'double',line:clean.hotelFinancialLines[0].id,checkin:todo.startDate,checkout:todo.endDate,rooms:2};const state={dossiers:{[clean.id]:{components:{[id]:component,'local-second':component},todos:{'local-second':{local:true,title:todo.title,tag:'hotel',done:true,startDate:todo.startDate,endDate:todo.endDate,quantity:2}}}}};assert.ok(get(clean,state).stays.every(r=>r.actual===null&&r.current===null));
});
test('summary covers whole selection, not just current pagination, and groups by check-in month',()=>{
 const list=Array.from({length:27},(_,i)=>({...booking(),id:'fixture-'+i,index:String(i)}));const result=hotelStays(list,{},[h],h.id,'2027-01-01','upcoming',1);assert.equal(result.stays.length,2);assert.equal(result.summary.bookings,27);assert.equal(result.months['2027-03'].roomNights,162);
});

test('list fetch imports only minimal financial fields with GET and stable unique keys',async()=>{
 const {fetchReishuisBookings}=await import('./reishuis-data.mjs');let calls=0;
 const result=await fetchReishuisBookings({config:{project:'il9cyh3m',dataset:'production',token:'fixture'},fetcher:async(u,o)=>{calls++;assert.equal(o.method,'GET');assert.equal(o.redirect,'error');const q=u.searchParams.get('query');assert.match(q,/"hotelFinancialLines":lines/);assert.doesNotMatch(q,/subTitle|description|email|address|notes|comment/);return {ok:true,json:async()=>({result:[{_id:'fixture-booking',hotelTodos:[todo],hotelFinancialLines:[{...line,costs:'199',subTitle:'Fictieve notitie'}]}]})};}});assert.equal(calls,1);assert.equal(result[0].hotelFinancialLines[0].costs,199);assert.equal(result[0].hotelFinancialLines[0].subTitle,undefined);assert.equal(result[0].hotelFinancialLines[0].id,normalizeDossier({_id:'fixture-booking',lines:[line]}).lines[0].id);
});
test('APO current price requires a unique or explicitly selected supplier and board, never cheapest guessing',()=>{
 const apo=structuredClone(h);apo.bookingPriceSource='apo';apo.rooms[0].apoRoom={docId:apo.id,path:'apoRooms.rate'};apo.apoRooms=[{key:'rate',prices:['2027-03-05','2027-03-06','2027-03-07'].flatMap(date=>[{date,price:100,source:'fixture-A',boardType:'RO'},{date,price:90,source:'fixture-B',boardType:'RO'}])}];
 const b=booking();assert.equal(hotelStays([b],{},[apo],apo.id,'2027-01-01').stays[0].current,null);const state={dossiers:{[b.id]:{components:{[b.hotelTodos[0].id]:{kind:'hotel',hotel:apo.id,room:'double',line:b.hotelFinancialLines[0].id,provider:'fixture-A',board:'RO',checkin:todo.startDate,checkout:todo.endDate,rooms:2}},lines:{[b.hotelFinancialLines[0].id]:{quantity:1,costs:180,_edited:['quantity','costs']}}}}};const r=hotelStays([b],state,[apo],apo.id,'2027-01-01').stays[0];assert.equal(r.actual,180);assert.equal(r.current,600);
});
