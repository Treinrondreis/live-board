import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBookletsMail} from './booklets-mail.mjs';
import {carrierReferences} from './booklets-carrier-mail.mjs';
import {extraProviders,extraAttachment,extraMessageReferences} from './booklets-extra-sources.mjs';
const raw=Buffer.from('%PDF-fictional-test');
function message(provider,body,names,subject='Documents',id='current',date='2000'){
 return {id,internalDate:date,payload:{headers:[{name:'From',value:'noreply@'+extraProviders[provider].domain},{name:'Subject',value:subject}],parts:[{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')}},...names.map(filename=>({mimeType:'application/octet-stream',filename,body:{data:raw.toString('base64url')}}))]}};
}
function fixture(provider,messages,pdf=async()=>[],bookings=[]){const calls=[],api=createBookletsMail({bookings:async()=>bookings,readPDF:pdf,google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{calls.push({path,args});return path==='messages'?{messages:messages.map(m=>({id:m.id}))}:messages.find(m=>path==='messages/'+m.id);}}});return {api,calls,search:q=>api.search({provider,query:q})};}

test('RateHawk selects Dutch once, excludes invoices, and binds each hotel reference',async()=>{
 const m=message('ratehawk','Booking 900000001; Booking 900000002',['voucher-en-900000001.pdf','voucher-nl-900000001.pdf','invoice-900000001.pdf','voucher-nl-900000002.pdf']);
 const f=fixture('ratehawk',[m]),r=await f.search('900000001');assert(r.messages[0].selected);assert.equal(r.messages[0].tickets.length,1);assert.equal(r.messages[0].tickets[0].title,'voucher-nl-900000001.pdf');assert.deepEqual(await f.api.download({ticket:r.messages[0].tickets[0].id}),raw);
 const english=await fixture('ratehawk',[message('ratehawk','',['voucher-en-900000001.pdf'])]).search('900000001');assert.equal(english.messages[0].tickets.length,1);
});
test('RateHawk automatic lookup is tied to the exact selected booking and hotel ToDo',async()=>{
 const b={_id:'fictional-booking',index:1234,todos:[{title:'Example Hotel',supplierBookingNumber:'900000001',startDate:'2028-06-06',endDate:'2028-06-08'}]},f=fixture('ratehawk',[message('ratehawk','',['voucher-nl-900000001.pdf'])],undefined,[b]);
 const r=await f.api.search({provider:'ratehawk',query:'1234',bookingId:b._id});assert.deepEqual(r.references,['900000001']);assert(r.messages[0].selected);
 await assert.rejects(f.api.search({provider:'ratehawk',query:'1234',bookingId:'other-booking'}),/geselecteerde/);
 assert.deepEqual(carrierReferences({todos:[{...b.todos[0],title:'Train ticket'}]},'ratehawk'),[]);
});
test('LTG verifies a booking number in its original PDF, not a Gmail search hit or wallet',async()=>{
 const m=message('ltg','Your tickets attached.',['tickets.pdf','route.pkpass','invoice.pdf']);let checks=0;
 const f=fixture('ltg',[m],async()=>{checks++;return ['E. ticket Nr. 280101000002\nBOOKING NUMBER 280101000001'];}),r=await f.search('280101000001');assert(r.messages[0].selected);assert.equal(r.messages[0].tickets.length,1);assert.equal(checks,1);
 assert.equal((await fixture('ltg',[m],async()=>['BOOKING NUMBER 280101999999']).search('280101000001')).messages.length,0);
});
test('RENFE imports an octet-stream PDF under its Localizador and excludes other bookings',async()=>{
 const f=fixture('renfe',[message('renfe','Localizador: ABC123',['ABC123.pdf','XYZ789.pdf','invoice.pdf'])]),r=await f.search('ABC123');assert.equal(r.messages[0].tickets.length,1);assert.deepEqual(await f.api.download({ticket:r.messages[0].tickets[0].id}),raw);
 assert.deepEqual(extraMessageReferences('renfe','','Localizador: ABC123'),['ABC123']);
});
test('Snälltåget excludes receipt files and a later welcome email does not hide the reservation',async()=>{
 const old=message('snalltaget','Reservation number: ABC123',['ABC123_20280601010101.pdf','ABC123_20280601010102_rcp.pdf'],'Your reservation from Snälltåget.se ABC123','ticket','1000'),welcome=message('snalltaget','Booking reference ABC123',[],'Welcome onboard Snälltåget! Booking reference ABC123');
 const r=await fixture('snalltaget',[welcome,old]).search('ABC123');assert.equal(r.messages.find(m=>m.selected).id,'ticket');assert.equal(r.messages.find(m=>m.selected).tickets.length,1);assert(!extraAttachment('ABC123_20280601010102_rcp.pdf','snalltaget'));
});
test('cancellation proof blocks older originals and unrelated senders cannot authorize PDFs',async()=>{
 for(const provider of ['ratehawk','renfe','snalltaget']){
  const ref=provider==='ratehawk'?'900000001':'ABC123',name=provider==='ratehawk'?'voucher-nl-'+ref+'.pdf':provider==='renfe'?ref+'.pdf':ref+'_20280601010101.pdf';
  const old=message(provider,'',[name],'Documents','old','1000'),cancel=message(provider,provider==='ratehawk'?'Booking '+ref:provider==='renfe'?'Localizador '+ref:'Reservation number '+ref,[],'Cancellation');
  assert(!(await fixture(provider,[cancel,old]).search(ref)).messages.some(m=>m.selected));
  old.payload.headers[0].value='spoof@'+extraProviders[provider].domain+'.example.org';assert.equal((await fixture(provider,[old]).search(ref)).messages.length,0);
 }
});

test('conflicting copies of a RateHawk voucher require manual selection',async()=>{
 const r=await fixture('ratehawk',[message('ratehawk','',['voucher-nl-900000001.pdf','voucher-nl-900000001.pdf'])]).search('900000001');assert.equal(r.messages[0].automatic,false);assert.match(r.messages[0].diagnostic,/Meerdere/);
});
