import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBookletsMail} from './booklets-mail.mjs';
import {carrierReferences,carrierSearchQuery,carrierSender,referenceDates} from './booklets-carrier-mail.mjs';
import {dfdsCustomerLinks,dfdsCustomerAttachment,dfdsMessageReferences} from './booklets-dfds.mjs';

const ref='12345678',agent='https://links.dfds.info/s/c/agent-example',customer='https://links.dfds.info/s/c/customer-example';
const html=`Boekingsnummer: ${ref}<a href="${agent}">DOWNLOAD BOEKINGSBEVESTIGING AGENT</a><a href="${customer}">DOWNLOAD NIEUWE BOEKINGSBEVESTIGING KLANT</a>`;
function mail(id='current',body=html,subject='Je boeking is gewijzigd - '+ref,from='DFDS <email@dfds.info>'){
 return {id,internalDate:id==='old'?'1000':'2000',payload:{headers:[{name:'From',value:from},{name:'Subject',value:subject}],parts:[{mimeType:'text/html',body:{data:Buffer.from(body).toString('base64url')}}]}};
}
function fixture(messages=[mail()],fetcher=async()=>new Response('%PDF-1.7\nfictional')){
 const calls=[],book={_id:'fictional-booking',index:1234,todos:[{title:'DFDS heenreis',supplierBookingNumber:ref,startDate:'2027-05-02'},{title:'DFDS terugreis',supplierBookingNumber:ref+'-2',startDate:'2027-05-05'},{title:'Hotel',supplierBookingNumber:'87654321'}]};
 const api=createBookletsMail({bookings:async()=>[book],fetcher,google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{calls.push({path,args});if(path==='messages')return {messages:messages.map(m=>({id:m.id}))};return messages.find(m=>path==='messages/'+m.id);}}});
 return {api,calls,book,search:()=>api.search({provider:'dfds',query:'1234',bookingId:book._id})};
}
test('DFDS booking references and both sailing dates stay bound to the exact booking',async()=>{
 const f=fixture();assert.deepEqual(carrierReferences(f.book,'dfds'),[ref]);assert.deepEqual(referenceDates(f.book,[ref],'dfds'),[{reference:ref,dates:['2027-05-02','2027-05-05']}]);
 assert.deepEqual(carrierReferences({notes:'DFDS: 12345678',todos:[{title:'Hotel',supplierBookingNumber:'87654321'}]},'dfds'),[ref]);
 const result=await f.search();assert.equal(result.providerKey,'dfds');assert.equal(result.messages[0].tickets.length,1);assert(result.messages[0].selected);assert(f.calls.filter(c=>c.path==='messages').every(c=>c.args.q.includes('from:dfds.info')&&c.args.q.includes('from:dfds.com')));
 assert.equal(carrierSearchQuery('dfds',ref),'{from:dfds.info from:dfds.com} "12345678" -in:spam -in:trash');
});
test('only one explicit customer link is selected; agent, ambiguous and unsafe links never substitute',()=>{
 assert.deepEqual(dfdsCustomerLinks(html),[customer]);
 assert.deepEqual(dfdsCustomerLinks(`<a href="${agent}">DOWNLOAD BOEKINGSBEVESTIGING AGENT</a>`),[]);
 assert.deepEqual(dfdsCustomerLinks(html+`<a href="https://links.dfds.info/s/c/other-example">DOWNLOAD BOEKINGSBEVESTIGING KLANT</a>`),[]);
 for(const url of ['https://evil.example/client.pdf','https://www.dfds.com/cancel','http://links.dfds.info/s/c/example'])assert.deepEqual(dfdsCustomerLinks(`<a href="${url}">DOWNLOAD BOEKINGSBEVESTIGING KLANT</a>`),[]);
 assert(dfdsCustomerAttachment('DFDS bevestiging klant.pdf'));assert(!dfdsCustomerAttachment('DFDS bevestiging agent.pdf'));assert(!dfdsCustomerAttachment('DFDS.pdf'));
});
test('download follows only approved read-only redirects and preserves all PDF bytes',async()=>{
 const urls=[],raw=Buffer.from('%PDF-1.7\nfictional outbound, return and guest list');
 const f=fixture(undefined,async u=>{urls.push(u.href);return urls.length===1?new Response(null,{status:302,headers:{Location:'https://www.dfds.com/api/booking-confirmation/12345678/ABCD'}}):new Response(raw);});
 const result=await f.search(),bytes=await f.api.download({ticket:result.messages[0].tickets[0].id});assert.deepEqual(bytes,raw);assert.equal(urls[0],customer);assert(!urls.includes(agent));
 const unsafe=fixture(undefined,async()=>new Response(null,{status:302,headers:{Location:'https://evil.example/ticket.pdf'}}));const r=await unsafe.search();await assert.rejects(unsafe.api.download({ticket:r.messages[0].tickets[0].id}),/Niet ondersteunde/);
 const notPdf=fixture(undefined,async()=>new Response('<html>expired</html>'));const n=await notPdf.search();await assert.rejects(notPdf.api.download({ticket:n.messages[0].tickets[0].id}),/geen PDF/);
});
test('latest cancellation or a changed booking without customer PDF blocks older confirmations',async()=>{
 for(const newest of [mail('new','Boekingsnummer: '+ref,'Je boeking is geannuleerd - '+ref),mail('new',`Boekingsnummer: ${ref}<a href="${agent}">DOWNLOAD BOEKINGSBEVESTIGING AGENT</a>`)]){
  const f=fixture([mail('old'),newest]),result=await f.search();assert(result.messages[0].latest);assert(!result.messages[0].selected);assert(!result.messages.find(m=>m.id==='old').selected);
 }
});
test('customer attachment and link do not import the same confirmation twice',async()=>{
 const attached=mail();attached.payload.parts.push({mimeType:'application/pdf',filename:'DFDS klant 12345678.pdf',body:{data:Buffer.from('%PDF-fictional').toString('base64url')}});
 let result=await fixture([attached]).search();assert.equal(result.messages[0].tickets.length,1);
 const attachmentOnly=mail('current','Boekingsnummer: '+ref);attachmentOnly.payload.parts.push(attached.payload.parts[1]);result=await fixture([attachmentOnly]).search();assert.equal(result.messages[0].tickets.length,1);
 attachmentOnly.payload.parts.push({...attached.payload.parts[1],filename:'DFDS klant tweede versie 12345678.pdf'});result=await fixture([attachmentOnly]).search();assert.equal(result.messages[0].tickets.length,0);
 assert.deepEqual(dfdsMessageReferences('Bedankt voor je boeking! - 12345678','Boekingsnummer: 87654321'),[]);
});
test('spoofed senders, unrelated references and forwarded agent replies are ignored',async()=>{
 assert(carrierSender('DFDS <email@dfds.info>','dfds'));assert(carrierSender('NL Info <nlinfo@dfds.com>','dfds'));assert(!carrierSender('bad@dfds.info.evil.example','dfds'));
 const bad=mail('bad','Boekingsnummer: 87654321','Bedankt voor je boeking! - 87654321');
 const f=fixture([mail('spoof',html,undefined,'bad@dfds.info.evil.example'),mail('reply',html,'Re: Je boeking is gewijzigd - '+ref),bad]);assert.equal((await f.search()).messages.length,0);
 assert.deepEqual(dfdsMessageReferences('Bedankt voor je boeking! - 12345678','Boekingsnummer: 12345678-2'),[ref]);
});
