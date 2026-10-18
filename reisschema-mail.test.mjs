import test from 'node:test';
import assert from 'node:assert/strict';
import {composeChangeMail,createChangeMail} from './reisschema-mail.mjs';
import {createReceiptHandler,createControlRoutes} from './reisschema-runtime.mjs';
import {createDraftGoogle,DRAFT_SCOPES} from './reisschema-gmail.mjs';
const now=Date.parse('2031-06-02T12:00:00.000Z');
const row={status:'active',version_id:'version',leg_id:'leg',dossier:'DEMO',train_number:'TEST 700',travel_date:'2031-06-10',arrival_date:'2031-06-10',departure_time:'10:00',arrival_time:'12:00',from_station:'Example North',to_station:'Example South',observation_revision:'revision-one',observation:{request_id:'obs',change_key:'change',departure_date:'2031-06-10',departure_time:'09:55',arrival_date:'2031-06-10',arrival_time:'12:10'},control:{outcome:'checked',observation_request_id:'obs',checked_at:new Date(now).toISOString()}};
function setup(){const kv=new Map(),events=[],drafts=[];let current=structuredClone(row);const read=async k=>structuredClone(kv.get(k)||{value:{},revision:0}),write=async(k,v,r)=>{const prior=kv.get(k);if((prior?.revision||0)!==r)throw Error('conflict');kv.set(k,{value:structuredClone(v),revision:r+1});return r+1;};
 const mail=createChangeMail({read,write,register:{summary:async()=>({available:true,legs:[current]}),recordLegEvent:async(v,k,e)=>{const prior=events.find(x=>x.e.request_id===e.request_id);if(prior)assert.deepEqual(prior,{v,k,e});else events.push({v,k,e});}},gmail:{status:async()=>({connected:true}),alias:async()=>({sendAsEmail:'contact@treinrondreis.nl',verificationStatus:'accepted',signature:'<p>Fictional signature</p>'}),createDraft:async d=>{drafts.push(d);return {id:'fictional-draft'};}},origin:'https://example.invalid',clock:()=>now});return {mail,events,drafts,kv,set current(v){current=v;}};}
const input={legId:'leg',changeKey:'change',observationRevision:'revision-one',to:'customer@example.invalid',destination:'Example South',advice:'Gebruik de eerdere vertrektijd. Uw back-up is beoordeeld.'};
test('mail uses date/destination of the travel day, escapes input and never claims attachment',()=>{
 const m=composeChangeMail(row,{destination:'Example <South>',advice:'Ask <team>',receiptUrl:'https://example.invalid/receipt',signature:'<p>Signature</p>'});assert.match(m.subject,/10-06-2031/);assert.match(m.html,/Example &lt;South&gt;/);assert.match(m.html,/<del>10:00<\/del>/);assert.doesNotMatch(m.html,/bijlage|persoonlijk antwoord/);assert.match(m.html,/iemand uit ons team/);
});
test('draft is idempotent and separate from communication; missing/degraded coverage blocks drafting',async()=>{
 const s=setup();await s.mail.draft(input);await s.mail.draft(input);assert.equal(s.drafts.length,1);assert.deepEqual(s.events.map(e=>e.k),['draft']);
 const m=setup();m.current={...row,control:{outcome:'manual'}};await assert.rejects(m.mail.draft(input));assert.equal(m.drafts.length,0);
});
test('receipt GET is read-only, requires registered communication and binds change episode',async()=>{
 const s=setup();await s.mail.draft(input);const html=s.drafts[0].html,token=html.match(/reisschema-ontvangst\/([\w-]+)/)[1];
 await s.mail.receipt(token);assert.equal(s.events.length,1);await assert.rejects(s.mail.receipt(token,true));
 s.current={...row,communication:{change_key:'change'}};await s.mail.receipt(token,true);assert.equal(s.events.at(-1).k,'receipt');
 s.current={...row,observation_revision:'revision-after-revert',communication:{change_key:'change'}};await assert.rejects(s.mail.receipt(token));
});
test('public receipt handler ignores scanner GET and rejects cross-origin POST',async()=>{
 const calls=[],handler=createReceiptHandler({mail:{receipt:async(...args)=>{calls.push(args);return {confirmed:false};}}}),token='x'.repeat(43);
 const call=async(method,origin)=>{let status;await handler({method,headers:{host:'example.invalid',origin,'content-type':'application/x-www-form-urlencoded'},async *[Symbol.asyncIterator](){yield 'confirm=yes';}},{setHeader(){},writeHead(s){status=s;},end(){}},new URL('https://example.invalid/reisschema-ontvangst/'+token));return status;};
 assert.equal(await call('GET'),200);assert.deepEqual(calls,[[token]]);assert.equal(await call('POST','https://foreign.invalid'),400);assert.equal(calls.length,1);assert.equal(await call('POST','https://example.invalid'),200);assert.deepEqual(calls.at(-1),[token,true]);
});
test('new control mutations require own origin and explicit header before touching storage',async()=>{
 const handler=createControlRoutes({cycle:{enable:async()=>assert.fail('write')},mail:{},google:{}});let status;
 await handler({method:'POST',headers:{host:'example.invalid',origin:'https://foreign.invalid','content-type':'application/json','x-reisschemas':'1'}},{writeHead(s){status=s;},end(){}},new URL('https://example.invalid/seinhuis/reisschemas/api/controls'));assert.equal(status,403);
});
test('concept OAuth is separate, requests no readonly scope and stores no plaintext verifier',async()=>{
 const kv=new Map(),read=async k=>kv.get(k)||{value:{},revision:0},write=async(k,v,r)=>{kv.set(k,{value:v,revision:r+1});return r+1;};
 const g=createDraftGoogle({read,write,configuration:()=>({id:'fictional-client',secret:'fictional-secret',origin:'https://example.invalid'}),clock:()=>now});
 const url=new URL(await g.start('fictional-session'));assert.deepEqual(url.searchParams.get('scope').split(' '),DRAFT_SCOPES);assert.equal(url.searchParams.get('include_granted_scopes'),'false');
 const record=[...kv.values()][0].value;assert.equal(record.pending.session.length,43);await assert.rejects(g.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'fictional'}),'another-session'));
});

test('selected run endpoint forwards only explicit selection and rejects other origins',async()=>{
 let called=0;const handler=createControlRoutes({cycle:{requestSelected:async ids=>{called++;assert.deepEqual(ids,['fictional-leg']);return {accepted:true,count:1};}},mail:{},google:{}});
 const request=async(origin,body)=>{let status,result;const req={method:'POST',headers:{host:'example.invalid',origin,'content-type':'application/json','x-reisschemas':'1'},async *[Symbol.asyncIterator](){yield JSON.stringify(body);}};await handler(req,{writeHead(s){status=s;},end(value){result=JSON.parse(value);}},new URL('https://example.invalid/seinhuis/reisschemas/api/run-controls'));return {status,result};};
 assert.equal((await request('https://foreign.invalid',{legIds:['fictional-leg']})).status,403);assert.equal(called,0);
 assert.equal((await request('https://example.invalid',{legIds:['fictional-leg']})).status,202);assert.equal(called,1);
 assert.equal((await request('https://example.invalid',{legIds:['fictional-leg'],all:true})).status,400);assert.equal(called,1);
});
