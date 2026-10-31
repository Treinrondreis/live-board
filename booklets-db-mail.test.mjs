import {test} from 'node:test';
import assert from 'node:assert/strict';
import {carrierSender,carrierSearchQuery,safeCarrierPDF} from './booklets-carrier-mail.mjs';
import {createBookletsMail} from './booklets-mail.mjs';
const reference='123456789012',original=Buffer.from('%PDF-fictional-db-ticket');
function message(id,domain,time,subject='DB ticket',files=['Ticket_example.pdf']){return {id,internalDate:String(time),payload:{headers:[{name:'From',value:'Example <tickets@'+domain+'>'},{name:'Subject',value:subject}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Auftragsnummer: '+reference).toString('base64url')}},...files.map(filename=>({filename,mimeType:'application/pdf',body:{data:original.toString('base64url')}}))]}};}
function setup(messages){const queries=[],api=createBookletsMail({bookings:async()=>[],google:{status:async()=>({connected:true}),reader:async()=>async(path,params)=>{if(path==='messages'){queries.push(params.q);return {messages:messages.map(m=>({id:m.id}))};}return messages.find(m=>path==='messages/'+m.id);}}});return {api,queries};}
test('DB searches both official sender domains and rejects lookalikes without widening download hosts',()=>{
 const q=carrierSearchQuery('db',reference);assert(q.includes('from:bahn.de'));assert(q.includes('from:deutschebahn.com'));assert(q.includes('"'+reference+'"'));
 for(const domain of ['bahn.de','deutschebahn.com','service.deutschebahn.com'])assert(carrierSender('Example <tickets@'+domain+'>','db'));
 for(const domain of ['evil-deutschebahn.com','deutschebahn.com.evil.example','bahn.com.evil.example'])assert(!carrierSender('tickets@'+domain,'db'));
 assert.equal(safeCarrierPDF('https://deutschebahn.com/private/file.pdf','db'),null);
});
test('new-domain DB ticket attachment retains its bytes and invoices stay excluded',async()=>{
 const {api,queries}=setup([message('current','deutschebahn.com',2000,'DB ticket',['Ticket_example.pdf','Rechnung.pdf'])]);
 const result=await api.search({provider:'db',query:reference});assert.equal(result.messages.length,1);assert(result.messages[0].selected);assert.equal(result.messages[0].tickets.length,1);assert.equal(result.excludedInvoices,1);assert(queries[0].includes('from:deutschebahn.com'));assert.deepEqual(await api.download({ticket:result.messages[0].tickets[0].id}),original);
});
test('DB cancellations on the new domain block older tickets on the old domain',async()=>{
 const {api}=setup([message('old','bahn.de',1000),message('cancelled','deutschebahn.com',2000,'Stornobestätigung',[])]);
 const result=await api.search({provider:'db',query:reference});assert(result.messages[0].cancelled);assert(result.messages.every(m=>!m.selected));
});
