import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBookletsMail} from './booklets-mail.mjs';
import {carrierReferences} from './booklets-carrier-mail.mjs';
import {moreProviders,moreMessageReferences,morePortal,safeMorePDF,eurostarBarcode} from './booklets-more-sources.mjs';
const pdf=Buffer.from('%PDF-fictional-original');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lV8AAAAASUVORK5CYII=','base64');
function message(p,body,names=[],subject='Documents',id='current',time='2000'){
 return {id,internalDate:time,payload:{headers:[{name:'From',value:'tickets@'+moreProviders[p].domain},{name:'Subject',value:subject}],parts:[{mimeType:'text/html',body:{data:Buffer.from(body).toString('base64url')}},...names.map(filename=>({mimeType:'application/octet-stream',filename,body:{data:pdf.toString('base64url')}}))]}};
}
function setup(provider,messages,options={}){const calls=[],api=createBookletsMail({bookings:async()=>options.bookings||[],readPDF:options.readPDF||(async()=>[]),fetcher:async(u,o)=>{calls.push({url:String(u),options:o});return new Response(options.image?png:pdf);},google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{calls.push({path,args});if(path==='messages')return {messages:messages.map(m=>({id:m.id}))};return messages.find(m=>path==='messages/'+m.id);}}});return {api,calls,search:q=>api.search({provider,query:q})};}
test('supplier PDFs retain original bytes and own references; invoices and image alternatives are excluded',async()=>{
 for(const [provider,ref,name] of [['sj','AB12CD34','AB12CD34_20280601010101.pdf'],['hovertravel','12345678','12345678.PDF'],['wightlink','12345678','12345678.PDF'],['pkp','WH12345678','Bilet - WH12345678.pdf'],['teldar','ABC123','ABC123~20280601_120000_001.pdf']]){
  const f=setup(provider,[message(provider,'',[name,'invoice.pdf','barcode.png'])]),r=await f.search(ref);assert.equal(r.messages[0].tickets.length,1,provider);assert.deepEqual(await f.api.download({ticket:r.messages[0].tickets[0].id}),pdf);
 }
});
test('ZSSK requires a branded ticket and an explicit standalone document number inside the PDF',async()=>{
 const m=message('zssk','Attached',['ZSSK_ITD_20280601010101.pdf']),ref='1234567890123456';
 assert((await setup('zssk',[m],{readPDF:async()=>['TICKET\n'+ref+'\nZSSK']}).search(ref)).messages[0].selected);
 assert.equal((await setup('zssk',[m],{readPDF:async()=>['Invoice '+ref]}).search(ref)).messages.length,0);
});
test('SNCF handles TER sender and permits only the exact original ticket CDN',async()=>{
 const url='https://genetix.eto.prod.cdn.vsct.fr/202801010/eto-12345678-abcd-1234-abcd-123456789012',m=message('sncf','Dossier voyage: ABC123 <a href="'+url+'">mon billet</a>');m.payload.headers[0].value='mesbillets@ter-sncf.fr';const f=setup('sncf',[m]),r=await f.search('ABC123');assert.equal(r.messages[0].tickets.length,1);assert.deepEqual(await f.api.download({ticket:r.messages[0].tickets[0].id}),pdf);
 for(const bad of [url+'?issue=true',url.replace('vsct.fr','vsct.fr.example.org'),url.replace('https:','http:'),'https://127.0.0.1/file.pdf'])assert.equal(safeMorePDF(bad,'sncf'),null);
});
test('Citylink prints the original email only with the matching original QR attachment',async()=>{
 const src='cid:qr_code_12345678_1_1234567890123.png',body='<html><p>Booking Ref: 12345678 Ticket No: ETS12345678</p><img src="'+src+'"></html>',m=message('citylink',body);m.payload.parts.push({filename:src.slice(4),mimeType:'application/octet-stream',headers:[{name:'Content-ID',value:'<'+src.slice(4)+'>'}],body:{data:png.toString('base64url')}});
 const f=setup('citylink',[m]),r=await f.search('12345678');assert(r.messages[0].tickets[0].mailDocument);const d=await f.api.document({ticket:r.messages[0].tickets[0].id});assert.equal(d.html,body);assert.deepEqual(Buffer.from(d.images[0].data,'base64'),png);assert(d.images[0].required);
 m.payload.parts.pop();assert.equal((await setup('citylink',[m]).search('12345678')).messages[0].tickets.length,0);
});
test('Eurostar copies original carrier barcodes and unwraps only a safe carrier ticket page',async()=>{
 const img='https://ticket.eurostar.com/barcode/ABC123/12345678901234',page='https://www.eurostar.com/manage-booking/en/booking?pnr=ABC123&market=uk',tracked='https://abc123.r.eu-west-1.awstrack.me/L0/'+encodeURIComponent(page)+'/token';
 const m=message('eurostar','<html>Booking reference: ABC123 Here are your tickets<img src="'+img+'"><a href="'+tracked+'">Print your tickets</a></html>',[],'Your Eurostar tickets');const f=setup('eurostar',[m],{image:true}),r=await f.search('ABC123');assert(r.messages[0].tickets[0].mailDocument);assert.match(r.messages[0].manualLinks[0].url,/^https:\/\/www.eurostar.com\/manage-booking/);const d=await f.api.document({ticket:r.messages[0].tickets[0].id});assert.deepEqual(Buffer.from(d.images[0].data,'base64'),png);assert.equal(f.calls.find(c=>c.url).options.redirect,'error');assert.equal(eurostarBarcode(img,['OTHER1']),null);assert.equal(morePortal('https://evil.example/manage-booking/en/booking?pnr=ABC123','eurostar'),'');
});
test('Go Nordic distinguishes official booking confirmations from agent correspondence',async()=>{
 const body='<html>Booking number: 123456 Remember to bring a valid photo ID. Departure 06/06/2028</html>';
 let r=await setup('gonordic',[message('gonordic',body,[],'Your booking is now confirmed')]).search('123456');assert(r.messages[0].tickets[0].mailDocument);
 r=await setup('gonordic',[message('gonordic',body,[],'Re: Booking request GNC#123456')]).search('123456');assert.equal(r.messages[0].tickets.length,0);
});
test('Teldar reminder does not hide a prepaid voucher; cancellation and ambiguity stop automatic use',async()=>{
 const old=message('teldar','',['ABC123~20280601_120000_001.pdf'],'Hotel booking','old','1000'),reminder=message('teldar','Reservation ABC123/1',[],'Days to cancel the reservation ABC123/1 without charge');let r=await setup('teldar',[reminder,old]).search('ABC123/1');assert.equal(r.messages.find(m=>m.selected).id,'old');
 reminder.payload.headers[1].value='HOTEL BOOKING CANCELLATION: ABC123/1';r=await setup('teldar',[reminder,old]).search('ABC123');assert(!r.messages.some(m=>m.selected));
 assert.deepEqual(carrierReferences({todos:[{title:'Example Hotel',startDate:'2028-06-06',endDate:'2028-06-08',supplierBookingNumber:'ABC123/1, ABC123/2'}]},'teldar'),['ABC123']);
});
test('each new supplier rejects unrelated senders and binds the exact chosen booking',async()=>{
 for(const provider of Object.keys(moreProviders)){const m=message(provider,'Booking reference: ABC123',[]);m.payload.headers[0].value='attacker@'+moreProviders[provider].domain+'.example.org';assert.equal((await setup(provider,[m]).search('ABC123')).messages.length,0);}
 const f=setup('sj',[],{bookings:[{_id:'right',index:1234,todos:[]}]});await assert.rejects(f.api.search({provider:'sj',query:'1234',bookingId:'wrong'}),/geselecteerde/);
});

test('HTML mail with another booking is never silently included, and repeated inline images are fetched once',async()=>{
 const foreign=message('eurostar','<html>Booking reference: ABC123 Booking reference: OTHER1 Here are your tickets<img src="https://ticket.eurostar.com/barcode/ABC123/12345678901234"></html>',[],'Your Eurostar tickets');assert.equal((await setup('eurostar',[foreign]).search('ABC123')).messages[0].tickets.length,0);
 const src='cid:qr_code_12345678_1_1234567890123.png',m=message('citylink','<html>Booking Ref: 12345678 Ticket No: ETS12345678<img src="'+src+'"><img src="'+src+'"></html>');m.payload.parts.push({filename:src.slice(4),mimeType:'application/octet-stream',headers:[{name:'Content-ID',value:'<'+src.slice(4)+'>'}],body:{data:png.toString('base64url')}});const f=setup('citylink',[m]),r=await f.search('12345678');assert.equal((await f.api.document({ticket:r.messages[0].tickets[0].id})).images.length,1);
});

test('signed Eurostar barcode parameters and original dashboard remain restricted to the matching carrier',()=>{
 const barcode='https://ticket.eurostar.com/barcode/ABC123/12345678-1234-1234-1234-123456789012?s='+encodeURIComponent('A'.repeat(43)+'=');
 assert(eurostarBarcode(barcode,['ABC123']));assert.equal(eurostarBarcode(barcode+'&next=https://example.org',['ABC123']),null);assert.equal(eurostarBarcode(barcode,['OTHER1']),null);
 const dashboard='https://eurostar.com/customer-dashboard/en/booking?pnr=ABC123&market=uk';
 assert.equal(morePortal('https://abc123.r.eu-west-1.awstrack.me/L0/'+encodeURIComponent(dashboard)+'/token','eurostar'),'https://www.eurostar.com/customer-dashboard/en/booking?pnr=ABC123');
});

test('ZSSK document number can share the carrier name line after its explicit label',()=>{
 assert.deepEqual(moreMessageReferences('zssk','','TICKET\nTČ: 1234567890123456 Železničná spoločnosť\nZSSK'),['1234567890123456']);
 assert.deepEqual(moreMessageReferences('zssk','','TICKET\nInvoice total 1234567890123456\nZSSK'),[]);
});
