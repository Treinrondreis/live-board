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
 for(const path of ['/api/rinkel','/api/rinkel/dossier?id=fixture-one','/api/rinkel/media?id=fixture-call&booking=fixture-one','/api/rinkel/audio?id=fixture-call&booking=fixture-one','/reishuis-rinkel-ui.js']){const req=Readable.from([]);req.method='GET';req.headers={};let status;await handler(req,{setHeader(){},writeHead:s=>{status=s;},end(){}},new URL('https://example.test/seinhuis/reishuis'+path));assert.equal(status,403);}assert.equal(reads,0);
});

test('opening after a call returns recent notices after phone warmup, without replay on subsequent polls',async()=>{
 let time=now;const service=createRinkelIncoming({...options,clock:()=>time}),state=emptyReishuis();await event(service);
 const warming=await service.poll({bookings,state});assert.equal(warming.ready,false);assert.equal(warming.cursor,undefined);
 await tick();const first=await service.poll({cursor:warming.cursor,bookings,state});assert.equal(first.recent,true);assert.equal(first.events.length,1);assert.deepEqual(first.events[0].matches,bookings);
 assert.equal((await service.poll({cursor:first.cursor,bookings,state})).events.length,0);
 const reload=await service.poll({bookings,state});assert.equal(reload.recent,true);assert.equal(reload.events.length,1);
 time+=1800001;assert.equal((await service.poll({bookings,state})).events.length,0);
});

test('manual conversation links persist separately from recognition, use server event data and preserve primary phones',async()=>{
 const service=createRinkelIncoming(options),state=emptyReishuis();await event(service);const input={call:'fixture-call',booking:'fixture-one',confirm:true,remember:false};
 service.linkCall(state,input,bookings,'fixture');assert.equal(service.dossier(state,'fixture-one').calls.length,1);assert.equal(service.dossier(state,'fixture-one').numbers.length,0);
 service.linkCall(state,{...input,remember:true},bookings,'fixture');assert.equal(service.dossier(state,'fixture-one').numbers.length,1);assert.ok(!JSON.stringify(state).includes(caller));assert.ok(!JSON.stringify(service.dossier(state,'fixture-one')).includes('digest'));
 await assert.rejects(async()=>service.linkCall(state,{...input,call:'forged'},bookings,'fixture'));
 await assert.rejects(async()=>service.linkCall(state,{...input,confirm:false},bookings,'fixture'));
 await service.poll({bookings,state});await tick();assert.equal((await service.poll({bookings,state})).events.find(e=>e.id==='fixture-call').linkedBooking,'fixture-one');
 const restored=JSON.parse(JSON.stringify(state));assert.equal(service.dossier(restored,'fixture-one').calls.length,1);
 const number=service.dossier(state,'fixture-one').numbers[0].id;service.removeNumber(state,{booking:'fixture-one',number,confirm:true},'fixture');assert.equal(service.dossier(state,'fixture-one').numbers.length,0);assert.equal(service.dossier(state,'fixture-one').calls.length,1);
});
test('extra number matches linked customer bookings without replacing the existing phone, conflicts fail closed',async()=>{
 const extra='+31990000009',service=createRinkelIncoming(options),state=emptyReishuis(),list=[...bookings,{...bookings[0],id:'fixture-two'}];
 await event(service,{data:{...payload('extra'),from:extra}});service.linkCall(state,{call:'extra',booking:'fixture-one',confirm:true,remember:true},list,'fixture');
 assert.throws(()=>service.linkCall(state,{call:'extra',booking:'fixture-two',confirm:true,remember:true},list,'fixture'));
 await service.poll({bookings:list,state});await tick();let r=await service.poll({bookings:list,state});assert.deepEqual(r.events[0].matches,bookings);
 state.links={'fixture-one':'customer-one','fixture-two':'customer-one'};r=await service.poll({bookings:list,state});assert.equal(r.events[0].matches.length,2);
 await event(service,{data:payload('primary')});r=await service.poll({bookings:list,state});assert.equal(r.events.find(e=>e.id==='primary').matches[0].id,'fixture-one');
});

test('historical conversation can be linked without a current call and survives reload, but unverified ids cannot',()=>{
 let time=now;const service=createRinkelIncoming({...options,clock:()=>time}),state=emptyReishuis();
 const rows=service.history([{id:'history-fixture',at:now-86400000,phone:caller}]);assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes(caller));
 service.linkCall(state,{call:'history-fixture',booking:'fixture-one',confirm:true,remember:true},bookings,'fixture');assert.equal(service.dossier(JSON.parse(JSON.stringify(state)),'fixture-one').calls[0].at,now-86400000);
 time+=1800001;assert.throws(()=>service.linkCall(state,{call:'history-fixture',booking:'fixture-one',confirm:true,remember:false},bookings,'fixture'));
});

test('manually added second and third phones recognize calls without changing the primary number',async()=>{
 const service=createRinkelIncoming(options),state=emptyReishuis();state.dossiers={'fixture-one':{contacts:{phones:[{value:'+31990000009',label:'Extra'}]}}};await service.poll({bookings,state});await tick();await event(service,{data:{...payload('extra-manual'),from:'+31990000009'}});await event(service,{data:payload('original')});const result=await service.poll({bookings,state});assert.equal(result.events.length,2);assert.ok(result.events.every(e=>e.matches[0].id==='fixture-one'));assert.ok(!JSON.stringify(result).includes('+31990000009'));
});

test('bulk linking validates every call before one atomic commit, preserving existing assignments on conflicts',async()=>{
 const rinkel=createRinkelIncoming(options);rinkel.history(['fixture-a','fixture-b','fixture-other'].map(id=>({id,at:now,phone:caller})));let state=emptyReishuis(),revision=0,writes=0;state.rinkelCalls={'fixture-other':{id:'fixture-other',booking:'fixture-two',at:now}};let snapshot;
 const h=createReishuisHandler({rinkel,origin:'https://example.test',authenticate:async()=>true,actor:async()=> 'fixture-user',read:async()=>({state:structuredClone(state),revision}),write:async(s,r)=>{assert.equal(r,revision);writes++;state=s;return ++revision;},readSnapshot:async()=>snapshot,writeSnapshot:async v=>snapshot=v,fetchBookings:async()=>bookings});
 const request=async(path,method='GET',data,more={})=>{const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;req.headers={cookie:'tr_google_session=fixture',...(method==='POST'?{origin:'https://example.test','content-type':'application/json','x-reishuis-csrf':token}:{}),...more};let status,body;await h(req,{setHeader(){},writeHead:s=>status=s,end:b=>body=b},new URL('https://example.test/seinhuis/reishuis'+path));return {status,json:()=>JSON.parse(body)};};
 let token;token=(await request('/api/state')).json().csrf;const data={action:'rinkel-link-many',calls:['fixture-a','fixture-b'],booking:'fixture-one',remember:true,confirm:true,revision};const before=JSON.stringify(state);
 for(const calls of [['fixture-a','unverified'],['fixture-a','fixture-other'],['fixture-a','fixture-a'],[],Array.from({length:26},(_,i)=>'fixture-'+i)]){const result=await request('/api/change','POST',{...data,calls});assert.ok([400,409].includes(result.status));assert.equal(JSON.stringify(state),before);assert.equal(writes,0);}
 assert.equal((await request('/api/change','POST',data,{origin:'https://evil.test'})).status,403);assert.equal((await request('/api/change','POST',{...data,revision:4})).status,409);assert.equal((await request('/api/change','POST',data)).status,200);assert.equal(writes,1);assert.equal(state.rinkelCalls['fixture-a'].booking,'fixture-one');assert.equal(state.rinkelCalls['fixture-b'].booking,'fixture-one');assert.equal(state.rinkelCalls['fixture-other'].booking,'fixture-two');assert.equal(state.rinkelNumbers['fixture-one'].length,1);assert.equal(state.history.filter(e=>e.actor==='fixture-user').length,2);assert.equal(state.dossiers['fixture-one'].audit.length,2);
});
test('audio routes honor byte ranges only after role and dossier membership checks',async()=>{
 const state=emptyReishuis();state.rinkelCalls={'fixture-call':{id:'fixture-call',booking:'fixture-one'}};let allowed=true,reads=0,snapshot;const h=createReishuisHandler({authenticate:async()=>allowed,read:async()=>({state,revision:0}),readSnapshot:async()=>snapshot,writeSnapshot:async v=>snapshot=v,fetchBookings:async()=>bookings,media:{configured:true,audio:async()=>{reads++;return {type:'audio/wav',bytes:Buffer.from('0123456789')};}}});
 const request=async(booking,range,check=false)=>{const req=Readable.from([]);req.method='GET';req.headers={...(range?{range}:{})};let status,body;const headers={};await h(req,{setHeader:(k,v)=>headers[k]=v,writeHead:(s,h)=>{status=s;Object.assign(headers,h);},end:b=>body=b},new URL('https://example.test/seinhuis/reishuis/api/rinkel/audio?id=fixture-call&booking='+booking+(check?'&check=1':'')));return {status,body,headers};};
 assert.equal((await request('other','bytes=0-1')).status,404);assert.equal(reads,0);const r=await request('fixture-one','bytes=0-1');assert.equal(r.status,206);assert.equal(r.body.toString(),'01');assert.equal(r.headers['Content-Range'],'bytes 0-1/10');assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal((await request('fixture-one','bytes=100-')).status,416);const checked=await request('fixture-one',null,true);assert.deepEqual(JSON.parse(checked.body),{available:true,type:'audio/wav',bytes:10});allowed=false;assert.equal((await request('fixture-one','bytes=0-1')).status,403);assert.equal(reads,3);
});
