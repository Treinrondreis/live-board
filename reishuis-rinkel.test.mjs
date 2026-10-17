import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createRinkelIncoming,normalizePhone,fetchPhoneIndex} from './reishuis-rinkel.mjs';
import {createReishuisHandler} from './reishuis.mjs';
import {emptyReishuis} from './reishuis-store.mjs';
const secret='a'.repeat(64),now=Date.parse('2026-10-17T12:00:00Z'),number='+31990000001',caller='+31990000002';
const payload=(id='fixture-call')=>({id,datetime:new Date(now).toISOString(),to:number,from:caller});
const event=async(service,{token=secret,data=payload(),method='POST',headers={}}={})=>{
 const req=Readable.from([Buffer.from(JSON.stringify(data))]);req.method=method;req.headers={'content-type':'application/json',...headers};let status,body;const out={};await service.receive(req,{writeHead:(s,h)=>{status=s;Object.assign(out,h);},end:b=>{body=b;}},new URL('https://example.test/integrations/rinkel/incoming/'+token));return {status,body,headers:out};
};
const options={enabled:true,secret,allowedNumbers:number,clock:()=>now,fetchPhones:async()=>[{id:'fixture-one',phone:caller,country:'nl'}]};
const bookings=[{id:'fixture-one',index:'9901',name:'Fictieve Reiziger',departure:'2027-01-01'}];
const tick=()=>new Promise(r=>setImmediate(r));
test('phone normalization requires exact international or known country context, never suffix matching',()=>{
 assert.equal(normalizePhone('00 31 (99) 000-0002'),caller);assert.equal(normalizePhone('0990000002','nl'),caller);assert.equal(normalizePhone('0990000002'),null);assert.equal(normalizePhone('anonymous'),null);assert.equal(normalizePhone('unknown'),null);assert.equal(normalizePhone('+31990000002 ext 1'),null);assert.equal(normalizePhone('123'),null);
});
test('phone index only reads id, contact phone and country using raw paginated GET',async()=>{
 let calls=0;const rows=await fetchPhoneIndex({config:{project:'il9cyh3m',dataset:'production',token:'fixture'},fetcher:async(u,o)=>{calls++;assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.match(u.searchParams.get('query'),/\{_id,phone,country\}/);assert.doesNotMatch(u.searchParams.get('query'),/passengers|emergency|email|notes/);return {ok:true,json:async()=>({result:[{_id:'fixture',phone:'published'},{_id:'drafts.fixture',phone:caller}]})};}});assert.equal(calls,1);assert.equal(rows.length,1);assert.equal(rows[0].phone,caller);
});
test('incoming endpoint fails closed when disabled and rejects wrong, unicode, browser and oversized requests',async()=>{
 assert.equal((await event(createRinkelIncoming())).status,404);const service=createRinkelIncoming(options);
 for(const token of ['bad','b'.repeat(64),'é'.repeat(64),secret+'/extra'])assert.equal((await event(service,{token})).status,404);
 assert.equal((await event(service,{method:'GET'})).status,405);assert.equal((await event(service,{headers:{origin:'https://evil.test'}})).status,403);assert.equal((await event(service,{headers:{'sec-fetch-site':'same-origin'}})).status,403);assert.equal((await event(service,{data:{...payload(),extra:'a'.repeat(5000)}})).status,413);
 const valid=await event(service);assert.equal(valid.status,200);assert.equal(valid.body,undefined);assert.equal(valid.headers['Cache-Control'],'private, no-store');
});
test('authenticated poll deduplicates calls, filters own numbers and stale events, and returns only minimal matches',async()=>{
 const service=createRinkelIncoming(options),state=emptyReishuis();let first=await service.poll({bookings,state});await tick();first=await service.poll({cursor:first.cursor,bookings,state});
 for(const data of [{...payload('old'),datetime:'2020-01-01'}, {...payload('other-number'),to:'+31990000009'}])assert.equal((await event(service,{data})).status,200);
 await event(service);await event(service);const next=await service.poll({cursor:first.cursor,bookings,state});assert.equal(next.events.length,1);assert.deepEqual(next.events[0].matches,bookings);assert.ok(!JSON.stringify(next).includes(caller));assert.ok(!JSON.stringify(next).includes(secret));assert.equal((await service.poll({cursor:next.cursor,bookings,state})).events.length,0);
 state.dossiers={'fixture-one':{personal:{phone:''}}};assert.equal((await service.poll({cursor:first.cursor,bookings,state})).events[0].matches.length,0,'cleared local contact overrides source phone');
 await event(service,{data:{...payload('anon'),from:'anonymous'}});const anon=await service.poll({cursor:next.cursor,bookings,state});assert.equal(anon.events[0].anonymous,true);assert.deepEqual(anon.events[0].matches,[]);
});
test('multiple bookings remain ambiguous and are never silently collapsed',async()=>{
 const service=createRinkelIncoming({...options,fetchPhones:async()=>[{id:'fixture-one',phone:caller},{id:'fixture-two',phone:caller}]}),state=emptyReishuis(),list=[...bookings,{...bookings[0],id:'fixture-two',index:'9902'}];const first=await service.poll({bookings:list,state});await tick();await event(service);const next=await service.poll({cursor:first.cursor,bookings:list,state});assert.equal(next.events[0].matches.length,2);
});
test('expired notices disappear and failed phone refresh does not silently use a stale index',async()=>{
 let time=now,fail=false;const service=createRinkelIncoming({...options,clock:()=>time,fetchPhones:async()=>{if(fail)throw Error('Sensitive source error');return [{id:'fixture-one',phone:caller}];}}),state=emptyReishuis();const first=await service.poll({bookings,state});await tick();await event(service);time+=301000;fail=true;await service.poll({cursor:first.cursor,bookings,state});await tick();const next=await service.poll({cursor:first.cursor,bookings,state});assert.equal(next.ready,false);assert.equal(next.failed,true);assert.equal(next.events,undefined);
});
test('Rinkel API and client module require explicit Reishuis authorization before state access',async()=>{
 let reads=0;const handler=createReishuisHandler({authenticate:async()=>false,read:async()=>{reads++;},rinkel:createRinkelIncoming(options)});
 for(const path of ['/api/rinkel','/reishuis-rinkel-ui.js']){const req=Readable.from([]);req.method='GET';req.headers={};let status;await handler(req,{setHeader(){},writeHead:s=>{status=s;},end(){}},new URL('https://example.test/seinhuis/reishuis'+path));assert.equal(status,403);}assert.equal(reads,0);
});
