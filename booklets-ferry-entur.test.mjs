import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBookletsMail} from './booklets-mail.mjs';
import {carrierReferences,referenceDates} from './booklets-carrier-mail.mjs';
import {ferryEnturAttachment} from './booklets-ferry-entur.mjs';
const domains={finnlines:'staff@finnlines.com',fjordline:'noreply@fjordline.com',entur:'no-reply@entur.org'};
function mail(p,subject,body,files=[],id='current',time='2000'){return {id,internalDate:time,payload:{headers:[{name:'From',value:domains[p]},{name:'Subject',value:subject}],parts:[{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')}},...files.map(filename=>({mimeType:'application/pdf',filename,body:{data:Buffer.from('%PDF-fictional').toString('base64url')}}))]}};}
function fixture(provider,messages,readPDF=async()=>['Ticket reference ABCD1234']){const calls=[],api=createBookletsMail({bookings:async()=>[],readPDF,google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{calls.push({path,args});return path==='messages'?{messages:messages.map(m=>({id:m.id}))}:messages.find(m=>path==='messages/'+m.id);}}});return {api,calls,search:query=>api.search({provider,query})};}
test('Finnlines accepts staff replies but selects only T documents for the exact reference',async()=>{
 const f=fixture('finnlines',[mail('finnlines','Re: reservation F280000001','Booking confirmation attached. Earlier booking F280000002',['T_F280000001_20280601120000.pdf','I_F280000001_20280601120000.pdf','T_F280000002_20280601120000.pdf'])]);
 const r=await f.search('F280000001');assert.equal(r.messages[0].tickets.length,1);assert(r.messages[0].selected);assert(r.messages[0].tickets[0].title.startsWith('T_F280000001'));
 assert.equal((await f.api.download({ticket:r.messages[0].tickets[0].id})).subarray(0,5).toString(),'%PDF-');
 assert.deepEqual(carrierReferences({todos:[{title:'Finnlines overtocht',supplierBookingNumber:'F280000001'}]},'finnlines'),['F280000001']);
});
test('a Finnlines payment refund is not treated as a canceled ferry booking',async()=>{
 const old=mail('finnlines','Booking F280000001','Booking confirmation',['T_F280000001_20280601120000.pdf'],'old','1000'),refund=mail('finnlines','Booking F280000001 / refund / double payment','Payment refund',[]);
 let r=await fixture('finnlines',[refund,old]).search('F280000001');assert(r.messages.find(m=>m.id==='old').selected);
 refund.payload.headers[1].value='Booking F280000001 cancelled';r=await fixture('finnlines',[refund,old]).search('F280000001');assert(!r.messages.some(m=>m.selected));
});
test('Fjord Line selects travel documents and excludes booking invoices',async()=>{
 const f=fixture('fjordline',[mail('fjordline','Fjord Line - Travel Document 12345678','Booking number: 12345678',['12345678.PDF','Invoice_12345678.pdf'])]),r=await f.search('12345678');assert.equal(r.messages[0].tickets.length,1);assert(r.messages[0].selected);
 assert(!ferryEnturAttachment('12345678.PDF','fjordline','FJORD LINE INVOICE 12345678'));
 assert.deepEqual(carrierReferences({todos:[{title:'Hotel',supplierBookingNumber:'12345678'}]},'fjordline'),[]);
});
test('Entur receipt has a concrete diagnostic and is never imported as a ticket',async()=>{
 const r=await fixture('entur',[mail('entur','Entur receipt, Ref: ABCD1234','This receipt is not valid as a ticket.',['sales-receipt-2028-06-01-ABCD1234.pdf'])]).search('ABCD1234');
 assert.equal(r.messages[0].tickets.length,0);assert.match(r.messages[0].diagnostic,/betalingsbewijs/);assert.match(r.messages[0].diagnostic,/Sanity/);assert(!r.messages[0].selected);
});
test('a renamed Entur receipt still fails PDF content validation, valid ticket attachments survive',async()=>{
 const m=mail('entur','Tickets, Ref: ABCD1234','Your reference ABCD1234',['ticket_ABCD1234.pdf']);
 const bad=await fixture('entur',[m],async()=>['Electronic sales receipt. This receipt is not valid as a ticket.']).search('ABCD1234');assert.equal(bad.messages[0].tickets.length,0);
 const good=await fixture('entur',[m]).search('ABCD1234');assert.equal(good.messages[0].tickets.length,1);
 const broken=await fixture('entur',[m],async()=>{throw Error('unreadable');}).search('ABCD1234');assert.equal(broken.messages[0].tickets.length,0);
});
test('supplier-specific reference patterns and sender domains prevent unrelated files',async()=>{
 for(const [p,ref] of [['finnlines','F280000001'],['fjordline','12345678'],['entur','ABCD1234']]){const m=mail(p,'Booking reference '+ref,'Your reference '+ref,['ticket.pdf']);m.payload.headers[0].value='bad@'+domains[p].split('@')[1]+'.evil.example';assert.equal((await fixture(p,[m]).search(ref)).messages.length,0);}
});
test('Entur can verify a reference inside a generically named ticket PDF',async()=>{
 const m=mail('entur','Your tickets','Tickets attached',['ticket.pdf']);const r=await fixture('entur',[m]).search('ABCD1234');assert(r.messages[0].selected);assert.equal(r.messages[0].tickets.length,1);
});

test('Finnlines allows the boarding day and the following printed departure, without guessing a PDF date',()=>{const booking={todos:[{title:'Finnlines overtocht',supplierBookingNumber:'F280000001',startDate:'2028-06-05',endDate:'2028-06-07'}]};assert.deepEqual(referenceDates(booking,['F280000001'],'finnlines'),[{reference:'F280000001',dates:['2028-06-05','2028-06-06']}]);booking.todos[0].endDate='2028-06-05';assert.deepEqual(referenceDates(booking,['F280000001'],'finnlines')[0].dates,['2028-06-05']);});
