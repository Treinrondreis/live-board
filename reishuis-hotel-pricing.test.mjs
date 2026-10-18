import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHotel} from './reishuis-hotels.mjs';
import {hotelNight,hotelCalendar} from './reishuis-hotel-pricing.mjs';
import {hotelAmount,quoteChange,applyQuote} from './reishuis-repricing.mjs';
const make=prices=>normalizeHotel({_id:'fixture',bookingPriceSource:'cms',rooms:[{_key:'room',title:'Fictieve kamer',prices}]});
const night=(h,d)=>hotelNight(h,h.rooms[0],d,[h]);
test('first matching contract wins; order, weekdays, inclusive ends and open bounds survive import',()=>{
 const h=make([{price:'180',available:[{start:'2028-02-01',end:'2028-02-29',availableDays:['0']}]},{price:'120.50',available:[{end:'2028-02-20'},{start:'2028-02-25'}]},{price:'95',available:[]}]);
 assert.equal(night(h,'2028-02-06').price,180);assert.equal(night(h,'2028-02-07').price,120.5);assert.equal(night(h,'2028-02-20').rule,1);assert.equal(night(h,'2028-02-21').price,95);assert.equal(night(h,'2028-02-25').price,120.5);
 const shadow=make([{price:'140'},{price:'80',available:[{start:'2028-01-01'}]}]);assert.equal(night(shadow,'2028-03-01').price,140);
 assert.equal(night(make([{price:'75',available:[{start:'2028-01-01',end:'2028-02-01',availableDays:[]}]}]),'2028-02-01').price,75);
});
test('unavailable or invalid first applicable price blocks lower rules and never yields free stays',()=>{
 for(const value of ['0','-5','NaN','120 invalid','',null]){const h=make([{price:value},{price:'99'}]);assert.ok(night(h,'2028-02-01').missing);assert.equal(night(h,'2028-02-01').rule,1);assert.equal(hotelAmount({hotel:h.id,room:'room',checkin:'2028-02-01',checkout:'2028-02-02',rooms:1},[h]).amount,undefined);}
 assert.ok(night(make([{price:'90',available:[{start:'2028-03-01'}]}]),'2028-02-01').missing);
 assert.ok(night(make([{price:'90',available:[{start:'bad'}]}]),'2028-02-01').missing);
 assert.ok(night({...make([]),pricingUnavailable:true},'2028-02-01').missing);
});
test('calendar and repricing share exact nightly rules, leap year, room count and exclusive checkout',()=>{
 const h=make([{price:'110',available:[{start:'2028-02-28'}]},{price:'100'}]);
 const calendar=hotelCalendar(h,h.rooms[0],'2028-02',[h]);assert.equal(calendar.days.length,29);
 const result=hotelAmount({hotel:h.id,room:'room',checkin:'2028-02-27',checkout:'2028-03-01',rooms:2},[h]);assert.equal(result.amount,640);assert.deepEqual(result.nights,calendar.days.slice(-3));
 for(const month of ['2028-13','2028-2','bad','2028-02-01'])assert.equal(hotelCalendar(h,h.rooms[0],month,[h]),null);
});
test('configured contract source never falls through to APO; configured APO keeps supplier choice',()=>{
 const h=make([{price:'130'}]);h.rooms[0].apoRoom={docId:h.id,path:'apoRooms.rate'};h.apoRooms=[{key:'rate',prices:[{date:'2028-02-01',price:60,source:'fixture',boardType:'RO'}]}];
 assert.equal(hotelNight(h,h.rooms[0],'2028-02-01',[h],{provider:'fixture',board:'RO'}).price,130);
 h.rooms[0].contractRates=[];assert.ok(night(h,'2028-02-01').missing);h.bookingPriceSource='apo';assert.equal(hotelNight(h,h.rooms[0],'2028-02-01',[h],{provider:'fixture',board:'RO'}).price,60);assert.ok(night(h,'2028-02-01').missing);
});

test('contract quote changes todo and finances together locally and retains completed task review',async()=>{
 const {normalizeDossier}=await import('./reishuis-dossier.mjs'),{emptyReishuis}=await import('./reishuis-store.mjs');
 const h=make([{price:'120'}]),source=normalizeDossier({_id:'fixture-booking',todos:[{_key:'stay',title:'Fictief verblijf',tag:'hotel',startDate:'2028-02-01',endDate:'2028-02-03',done:true}],lines:[{_key:'line',title:'Fictief verblijf',price:200,quantity:1}]}),before=structuredClone(source);
 const input={todo:source.todos[0].id,line:source.lines[0].id,kind:'hotel',title:'Fictief verblijf',mode:'auto',hotel:h.id,room:'room',checkin:'2028-02-01',checkout:'2028-02-04',rooms:2},plan=quoteChange(source,{},input,{hotels:[h],interrail:[]});
 assert.equal(plan.missing.length,0);assert.equal(plan.newTotal,720);assert.deepEqual(source,before);const saved=applyQuote(emptyReishuis(),'fixture-booking',source,plan,'fixture-user');assert.equal(saved.dossiers['fixture-booking'].lines[source.lines[0].id].price,720);assert.equal(saved.dossiers['fixture-booking'].todos[source.todos[0].id].endDate,'2028-02-04');assert.equal(saved.dossiers['fixture-booking'].reviews.length,1);assert.deepEqual(source,before);
});
