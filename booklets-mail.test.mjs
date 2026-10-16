import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBookletsMail,bookingReferences,nsTicketSender} from './booklets-mail.mjs';
const link=n=>`https://www.bene-system.com/hp/pdfservice?pdf=fixture${n}`;
const message=(id,ref,date,links,own='1234A',extra='')=>({id,internalDate:String(Date.parse(date)),payload:{headers:[{name:'From',value:'no-reply@confirmation.nsinternational.nl'},{name:'Subject',value:`${extra||'Bevestiging'}, naam: ${own}, boekingscode: ${ref}`}],parts:[{mimeType:'text/html',body:{data:Buffer.from(links.map(n=>`<a href="${link(n)}">Tickets</a>`).join('')).toString('base64url')}}]}});
function fixture(extra={}){const messages=[message('old','ABCDEFG','2026-01-01',[1]),message('new','ABCDEFG','2026-02-01',[2,3],'1235A'),message('other','HIJKLMN','2026-01-15',[4])];let now=Date.now();return {messages,setTime:n=>now=n,control:createBookletsMail({clock:()=>now,google:{status:async()=>({connected:true}),reader:async()=>async(path)=>path==='messages'?{messages:messages.map(m=>({id:m.id}))}:messages.find(m=>path==='messages/'+m.id)},bookings:async()=>[{_id:'private.test',index:1234,notes:'DNR: ABCDEFG',todos:[{supplierBookingNumber:'HIJKLMN'}]}],state:async()=>({state:{bookings:[]}}),...extra})};}
test('Sanity reference formats and newest mail per separate dossier keep all PDF buttons',async()=>{
 assert.deepEqual(bookingReferences({notes:'DNR: ABCDEFG; NS International HIJKLMN',todos:[{supplierBookingNumber:'ABCDEFG/0'}]}),['ABCDEFG','HIJKLMN']);
 const f=fixture(),r=await f.control.search({query:'1234A'});assert.equal(r.messages.length,3);assert.deepEqual(r.messages.filter(m=>m.selected).map(m=>m.id),['new','other']);assert.equal(r.messages[0].tickets.length,2);assert.equal(r.messages[0].bookingLabel,'1235A');assert.equal(r.messages[2].selected,false);
});
test('cancelled latest mail does not silently reuse old tickets',async()=>{const f=fixture();f.messages.push(message('cancel','ABCDEFG','2026-03-01',[],'1234A','Geannuleerd'));const r=await f.control.search({query:'ABCDEFG'});assert.equal(r.messages[0].cancelled,true);assert.equal(r.messages.find(m=>m.id==='new').selected,false);});
test('download uses opaque selection, validates redirects and expiry',async()=>{
 const f=fixture({fetcher:async()=>new Response(Buffer.from('%PDF-test'),{headers:{'Content-Type':'application/pdf'}})}),r=await f.control.search({query:'ABCDEFG'}),id=r.messages[0].tickets[0].id;
 assert.equal((await f.control.download({ticket:id})).toString(),'%PDF-test');assert(!JSON.stringify(r).includes('bene-system'));f.setTime(Date.now()+1900000);await assert.rejects(f.control.download({ticket:id}),/verlopen/);
 const g=fixture({fetcher:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}})}),x=await g.control.search({query:'ABCDEFG'});await assert.rejects(g.control.download({ticket:x.messages[0].tickets[0].id}),/verwijzing/);
});
test('query injection and an unconnected mailbox stop search',async()=>{await assert.rejects(fixture().control.search({query:'x" OR in:anywhere'}),/boekingsnummer/);await assert.rejects(fixture({google:{status:async()=>({connected:false})}}).control.search({query:'ABCDEFG'}),/Gmail/);});

test('duplicate booking lookup requires exact Sanity document and only its references are used',async()=>{const f=fixture({bookings:async()=>[{_id:'private.one',index:1234,notes:'DNR: ABCDEFG'},{_id:'private.two',index:1234,notes:'DNR: HIJKLMN'}]});await assert.rejects(f.control.search({query:'1234A'}),/meermaals/);const r=await f.control.search({query:'1234A',bookingId:'private.two'});assert.deepEqual(r.references,['HIJKLMN']);await assert.rejects(f.control.search({query:'1234A',bookingId:'private.missing'}),/hoort niet/);});

test('newer NS desk confirmations retain all ticket PDFs and replace the older confirmation',async()=>{
 const queries=[],f=fixture(),newer=message('desk','ABCDEFG','2027-02-01',[5,6]);
 newer.payload.headers[0].value='NS desk <ns@treinrondreis.nl>';f.messages.push(newer);
 const reader=f.control;
 const result=await reader.search({query:'ABCDEFG'});
 assert.equal(result.messages[0].id,'desk');assert.equal(result.messages[0].tickets.length,2);assert(result.messages[0].selected);assert(!result.messages.find(m=>m.id==='new').selected);
 const control=createBookletsMail({google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{queries.push(args.q);return {messages:[]};}},state:async()=>({state:{bookings:[]}})});
 await control.search({query:'ABCDEFG'});assert(queries[0].includes('from:no-reply@confirmation.nsinternational.nl'));assert(queries[0].includes('from:ns@treinrondreis.nl'));
 assert(nsTicketSender('NS desk <ns@treinrondreis.nl>'));assert(!nsTicketSender('ns@treinrondreis.nl.evil.example'));assert(!nsTicketSender('other@treinrondreis.nl'));assert(!nsTicketSender('ns@evil.example'));
});

test('an NS desk option or unrelated sender cannot replace a confirmed ticket mail',async()=>{
 const f=fixture(),option=message('desk-option','ABCDEFG','2027-02-01',[5],'fixture','Optieboeking'),foreign=message('foreign','ABCDEFG','2027-03-01',[6]);
 option.payload.headers[0].value='ns@treinrondreis.nl';foreign.payload.headers[0].value='ns@evil.example';f.messages.push(option,foreign);
 const result=await f.control.search({query:'ABCDEFG'});assert.equal(result.messages[0].id,'new');assert(!result.messages.some(m=>m.id==='desk-option'||m.id==='foreign'));
});
