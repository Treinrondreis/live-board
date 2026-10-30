import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBookletsMail} from './booklets-mail.mjs';
import {carrierReferences,referenceDates} from './booklets-carrier-mail.mjs';
import {retailAttachment,retailMessageReferences,retailPortal,retailSearchQuery} from './booklets-retail-mail.mjs';

// All bookings, references, passenger labels and PDFs below are fictional.
const domains={trainline:'auto-confirm@info.thetrainline.com',raileurope:'checkout@raileurope.com',sbb:'sbbclient@order.info.sbb.ch'};
function mail(provider,body,files=[],extra={}){return {id:'current',internalDate:'2000',payload:{headers:[{name:'From',value:domains[provider]},{name:'Subject',value:'Tickets'}],parts:[{mimeType:'text/html',body:{data:Buffer.from(body).toString('base64url')}},...files.map(filename=>({mimeType:'application/pdf',filename,body:{data:Buffer.from('%PDF-1.7\nfictional ticket').toString('base64url')}}))]},...extra};}
function setup(provider,messages,{bookings=[],readPDF=async()=>[]}={}){
 const reads=[],api=createBookletsMail({bookings:async()=>bookings,readPDF,google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{reads.push({path,args});if(path==='messages')return {messages:messages.map(m=>({id:m.id}))};return messages.find(m=>path==='messages/'+m.id);}}});
 return {api,reads,search:query=>api.search({provider,query})};
}
test('Trainline imports every UK traveller and direction under the transaction ID',async()=>{
 const names=['Adult_1_Examplecity_02_may_2027.pdf','Adult_2_Examplecity_02_may_2027.pdf','Adult_1_Examplestation_05_may_2027.pdf','Adult_2_Examplestation_05_may_2027.pdf'];
 const f=setup('trainline',[mail('trainline','Je transactie-ID: 123456789012',names)]),r=await f.search('123456789012');
 assert.equal(r.messages[0].tickets.length,4);assert(r.messages[0].selected);assert(f.reads[0].args.q.includes('from:(thetrainline.com)'));
 assert.equal((await f.api.download({ticket:r.messages[0].tickets[0].id})).subarray(0,5).toString(),'%PDF-');
});
test('Trainline only imports the requested PNR from an email containing two bookings',async()=>{
 const f=setup('trainline',[mail('trainline','PNR-referentie &#8202; ABC123 PNR-referentie XYZ789',['ABC123_Examplecity_02_may_2027_Ticket1.pdf','XYZ789_Examplestation_05_may_2027_Ticket1.pdf'])]),r=await f.search('XYZ789');
 assert.equal(r.messages[0].tickets.length,1);assert(r.messages[0].tickets[0].title.startsWith('XYZ789_'));assert.equal(r.messages[0].tickets[0].reference,'XYZ789');
 assert.deepEqual(retailMessageReferences('trainline','','Transactie-ID: 123456789012'),['123456789012']);
});
test('Rail Europe normalizes RE order references and keeps the complete ticket bundle',async()=>{
 const f=setup('raileurope',[mail('raileurope','Your order reference: RE-ABC123',['Tickets.pdf','Invoice.pdf'])]);const r=await f.search('RE-ABC123');
 assert.equal(r.messages[0].tickets.length,1);assert.equal(r.excludedInvoices,1);assert(r.messages[0].selected);assert.match(retailSearchQuery('raileurope','REABC123'),/"RE-ABC123"/);
});
test('a Rail Europe PNR found only inside a PDF must be verified, never inferred from a Gmail hit',async()=>{
 const m=mail('raileurope','Your order reference RE-ABC123',['Tickets.pdf']);let reads=0;
 const f=setup('raileurope',[m],{readPDF:async()=>{reads++;return ['My ticket\nBooking : XYZ789\nTraveller: Example'];}}),r=await f.search('XYZ789');assert.equal(reads,1);assert(r.messages[0].selected);
 const unrelated=setup('raileurope',[m],{readPDF:async()=>['My ticket\nBooking : OTHER1']});assert.equal((await unrelated.search('XYZ789')).messages.length,0);
});
test('a matching PDF cannot authorize another unverified PDF in the same mail',async()=>{
 let n=0;const f=setup('raileurope',[mail('raileurope','Order reference RE-ABC123',['Tickets_one.pdf','Tickets_two.pdf'])],{readPDF:async()=>++n===1?['Booking : XYZ789']:['Unreadable content']});
 assert.equal((await f.search('XYZ789')).messages[0].tickets.length,1);
});
test('SBB order pages get an actionable link; newsletters and luggage confirmations are excluded',async()=>{
 const portal='https://shop.sbb.ch/customer/de/alw/order?orderId=00000000-0000-4000-8000-000000000001';
 const f=setup('sbb',[mail('sbb',`Bestell-Nr.: 123456789012 <a href="${portal}">Billett</a>`,['Order_confirmation_B000000001.pdf','News GoPEx 2027_EN.pdf'])]),r=await f.search('123456789012');
 assert.equal(r.messages[0].tickets.length,0);assert.equal(r.messages[0].manualLinks[0].url,portal);assert(!r.messages[0].selected);
 assert.equal(retailPortal(portal+'&refund=true','sbb'),'');assert.equal(retailPortal(portal.replace('shop.sbb.ch','shop.sbb.ch.evil.example'),'sbb'),'');
 assert.equal(retailPortal('https://shop.sbb.ch/customer/de/alw/refund?orderId=00000000-0000-4000-8000-000000000001','sbb'),'');
});
test('SBB GoPEx numeric attachments require the actual sender and reservation context',async()=>{
 const m=mail('sbb','Order no. 1234567890',['1234567890.pdf']);m.payload.headers=[{name:'From',value:'shop-gopex@sbb.ch'},{name:'Subject',value:'Your order for the Gotthard Panorama Express (order no. 1234567890)'}];
 assert((await setup('sbb',[m]).search('1234567890')).messages[0].selected);
 assert(!retailAttachment('1234567890.pdf','sbb','Tickets','other@sbb.ch'));
 const byReservation=setup('sbb',[m],{readPDF:async()=>['Confirmation of seat reservation\nReservationsnummer 123456-1']});assert((await byReservation.search('123456-1')).messages[0].selected);
});
test('exact booking binding, provider hints and both departure dates are retained',async()=>{
 const book={_id:'fictional-book',index:1234,todos:[{title:'Trainline train',supplierBookingNumber:'ABC123',startDate:'2027-05-02'},{title:'Trainline train retour',supplierBookingNumber:'ABC123',startDate:'2027-05-05'},{title:'Hotel',supplierBookingNumber:'XYZ789'},{title:'SBB ticket',supplierBookingNumber:'123456789012'}]};
 assert.deepEqual(carrierReferences(book,'trainline'),['ABC123','123456789012']);assert.deepEqual(carrierReferences(book,'sbb'),['123456789012']);
 assert.deepEqual(referenceDates(book,['ABC123'],'trainline'),[{reference:'ABC123',dates:['2027-05-02','2027-05-05']}]);
 const f=setup('trainline',[mail('trainline','PNR-referentie ABC123',['ABC123_Example_02_may_2027_Ticket1.pdf'])],{bookings:[book,{...book,_id:'other-book'}]});
 await assert.rejects(f.search('1234'),/meermaals/);await assert.rejects(f.api.search({provider:'trainline',query:'1234',bookingId:'wrong'}),/hoort niet/);
 assert.equal((await f.api.search({provider:'trainline',query:'1234',bookingId:book._id})).booking,'1234');
});
test('a newer receipt does not hide tickets; a cancellation blocks the older version',async()=>{
 const old=mail('trainline','PNR-referentie ABC123',['ABC123_Example_02_may_2027_Ticket1.pdf'],{id:'old',internalDate:'1000'}),receipt=mail('trainline','PNR-referentie ABC123',['Invoice.pdf']);
 let r=await setup('trainline',[receipt,old]).search('ABC123');assert(r.messages.find(m=>m.id==='old').selected);
 const cancel=mail('trainline','PNR-referentie ABC123');cancel.payload.headers[1].value='Booking canceled';r=await setup('trainline',[cancel,old]).search('ABC123');assert(r.messages[0].cancelled);assert(!r.messages.some(m=>m.selected));
});
test('spoofed senders and unsupported PDF names are not imported',async()=>{
 const m=mail('raileurope','Your order reference RE-ABC123',['Tickets.pdf']);m.payload.headers[0].value='bad@raileurope.com.evil.example';assert.equal((await setup('raileurope',[m]).search('RE-ABC123')).messages.length,0);
 for(const p of ['trainline','raileurope','sbb'])for(const name of ['Invoice.pdf','Refund.pdf','Order_confirmation.pdf','Newsletter.pdf'])assert(!retailAttachment(name,p));
});
