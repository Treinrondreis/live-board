import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createReishuisResources,itineraryLink} from './reishuis-resources.mjs';
import {createReishuisHandler} from './reishuis.mjs';
import {emptyReishuis} from './reishuis-store.mjs';
const booking={id:'fixture-booking',index:'90000001',name:'Fictieve Reiziger'},leg={leg_id:'fixture-leg',dossier:'90000001A',status:'active',travel_date:'2027-01-01',from_station:'Voorbeeld Noord',to_station:'Voorbeeld Zuid',train_number:'TEST 42',document_url:'https://docs.google.com/document/d/fixture/edit',private:'never expose'};
test('itinerary links accept only fixed Google document/file destinations',()=>{
 for(const url of ['javascript:alert(1)','https://evil.example/file/d/fixture','https://docs.google.com.evil.example/document/d/fixture','https://user@docs.google.com/document/d/fixture','http://docs.google.com/document/d/fixture'])assert.equal(itineraryLink(url),null);
 assert.match(itineraryLink(leg.document_url).pdf,/export\?format=pdf/);assert.match(itineraryLink('https://drive.google.com/file/d/fixture/view').pdf,/export=download/);
});
test('resources filter exact booking, active itinerary, minimal fields, unique number and linked letters',async()=>{
 let reads=0;const documents={documents:async()=>({items:[{id:'fixture-letter',kind:'letter',title:'Fictieve brief'},{id:'fixture-voucher',kind:'voucher'}]}),document:async()=>({originalPdf:Buffer.from('%PDF-fictional').toString('base64')})};
 const resource=createReishuisResources({documents,findLegs:async()=>{reads++;return [leg,{...leg,leg_id:'other',dossier:'90000002A'},{...leg,leg_id:'old',status:'superseded'}];}});
 const result=await resource.overview(booking,[booking]);assert.equal(result.itinerary.legs.length,1);assert.equal(result.itinerary.legs[0].private,undefined);assert.equal(result.itinerary.documents.length,1);assert.equal(result.letters.length,1);assert.equal(result.documentsAvailable,true);assert.equal(reads,2);
 const ambiguous=await resource.overview(booking,[booking,{...booking,id:'fixture-twin'}]);assert.equal(ambiguous.ambiguous,true);assert.equal(reads,2);assert.equal((await resource.letter(booking.id,'fixture-letter')).toString(),'%PDF-fictional');await assert.rejects(()=>resource.letter(booking.id,'fixture-voucher'));
 const failed=await createReishuisResources({documents:{documents:async()=>{throw Error('private upstream detail');}},findLegs:async()=>{throw Error('private upstream detail');}}).overview(booking,[booking]);assert.equal(failed.itinerary.available,false);assert.equal(failed.documentsAvailable,false);assert.doesNotMatch(JSON.stringify(failed),/private upstream/);
});
test('resource and PDF routes require Reishuis role, own origin and booking membership',async()=>{
 let allowed=false,reads=0;const h=createReishuisHandler({origin:'https://example.test',authenticate:async()=>allowed,read:async()=>({state:emptyReishuis(),revision:0}),readSnapshot:async()=>null,writeSnapshot:async()=>{},fetchBookings:async()=>[booking],resources:{overview:async()=>{reads++;return {itinerary:{legs:[]},letters:[]};},letter:async()=>{reads++;return Buffer.from('%PDF-fictional');}}});
 const call=async(path,headers={})=>{const req=Readable.from([]);req.method='GET';req.headers=headers;let status,body;const hs={};await h(req,{setHeader:(k,v)=>hs[k]=v,writeHead:(s,v)=>{status=s;Object.assign(hs,v);},end:b=>body=b},new URL('https://example.test/seinhuis/reishuis'+path));return {status,body,headers:hs};};
 for(const path of ['/api/activity','/api/resources?id=fixture-booking','/api/letter?id=fixture-booking&document=fixture-letter'])assert.equal((await call(path)).status,403);assert.equal(reads,0);allowed=true;
 assert.equal((await call('/api/resources?id=missing')).status,404);assert.equal((await call('/api/resources?id=fixture-booking',{origin:'https://evil.example'})).status,403);assert.equal((await call('/api/resources?id=fixture-booking',{'sec-fetch-site':'cross-site'})).status,403);assert.equal(reads,0);
 const result=await call('/api/resources?id=fixture-booking');assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'private, no-store');const pdf=await call('/api/letter?id=fixture-booking&document=fixture-letter');assert.equal(pdf.status,200);assert.equal(pdf.headers['Content-Type'],'application/pdf');assert.match(pdf.headers['Content-Disposition'],/attachment/);
});
