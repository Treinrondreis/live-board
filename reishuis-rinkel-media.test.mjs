import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioType,audioRange,createRinkelMedia} from './reishuis-rinkel-media.mjs';
const number='+31990000001',call={id:'fixture-call'},record={callId:call.id,internalNumber:{number},callRecording:{id:'fixture-recording'},insights:{summary:'Fictieve afspraak'}};
const response=data=>new Response(JSON.stringify({data}),{headers:{'content-type':'application/json'}});
test('read-only media access validates call and business line before exposing minimal insights',async()=>{
 let calls=0;const service=createRinkelMedia({key:'fixture-key',allowedNumbers:number,fetcher:async(url,opts)=>{calls++;assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer fixture-key');assert.ok(String(url).startsWith('https://api.rinkel.com/v1/call-detail-records/by-call-id/fixture-call'));return response(record);}});
 assert.deepEqual(await service.info(call),{recording:true,summary:'Fictieve afspraak'});assert.equal(calls,1);
 for(const data of [{...record,callId:'other'},{...record,internalNumber:{number:'+31990000009'}}])await assert.rejects(createRinkelMedia({key:'fixture',allowedNumbers:number,fetcher:async()=>response(data)}).info(call));
 let accessed=false;await assert.rejects(createRinkelMedia({key:'',fetcher:async()=>{accessed=true;}}).info(call));assert.equal(accessed,false);
});
test('audio proxy keeps temporary URL and credential server-side and rejects redirects or foreign audio hosts',async()=>{
 const requests=[];const service=createRinkelMedia({key:'fixture-key',allowedNumbers:number,fetcher:async(url,opts)=>{requests.push({url:String(url),opts});if(requests.length===1)return response(record);if(requests.length===2)return response({url:'https://api.rinkel.com/audio/call-recording/fixture?token=fixture'});return new Response('fixture audio',{headers:{'content-type':'audio/mpeg'}});}});
 const audio=await service.audio(call);assert.equal(audio.type,'audio/mpeg');assert.equal(audio.bytes.toString(),'fixture audio');assert.equal(requests[2].opts.headers,undefined);assert.equal(requests[2].opts.redirect,'error');
 let step=0;const hostile=createRinkelMedia({key:'fixture',allowedNumbers:number,fetcher:async()=>response(++step===1?record:{url:'https://evil.test/recording'})});await assert.rejects(hostile.audio(call));assert.equal(step,2);
});

test('historical lookup is exact-number scoped, paginated and excludes the third line',async()=>{
 const external='+31990000002',rows=[{...record,date:'2026-10-01T12:00:00Z',externalNumber:{e164:external}},{...record,callId:'excluded',internalNumber:{number:'+31990000009'},externalNumber:{e164:external}},{...record,callId:'wrong-caller',externalNumber:{e164:'+31990000003'}}];
 const service=createRinkelMedia({key:'fixture',allowedNumbers:number,fetcher:async(url,opts)=>{const u=new URL(url);assert.equal(opts.method,'GET');assert.equal(u.searchParams.get('externalNumber'),external);assert.equal(u.searchParams.get('perPage'),'25');assert.equal(u.searchParams.get('page'),'2');assert.equal(u.searchParams.get('contactLookup'),'false');return response(rows);}});
 const result=await service.history(external,2);assert.equal(result.rows.length,1);assert.equal(result.rows[0].id,'fixture-call');assert.equal(result.hasMore,false);await assert.rejects(service.history('0990000002',2));await assert.rejects(service.history(external,0));
});

test('provider failure reports only its HTTP status, never credentials or response contents',async()=>{
 const service=createRinkelMedia({key:'fixture-key',allowedNumbers:number,fetcher:async()=>new Response('private provider body',{status:401})});
 await assert.rejects(service.info(call),e=>e.rinkelStatus===401&&!e.message.includes('private provider body')&&!e.message.includes('fixture-key'));
});

test('documented legacy API-key header is tried once for incompatible Bearer authentication',async()=>{
 let count=0;const service=createRinkelMedia({key:'fixture-key',allowedNumbers:number,fetcher:async(url,opts)=>{count++;if(count===1){assert.equal(opts.headers.Authorization,'Bearer fixture-key');return new Response('fixture',{status:500});}assert.equal(opts.headers['x-rinkel-api-key'],'fixture-key');assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return response(record);}});
 assert.equal((await service.info(call)).summary,'Fictieve afspraak');assert.equal(count,2);
});

test('known audio aliases and binary WAV/MP3 downloads are recognized without accepting HTML',()=>{assert.equal(audioType('audio/x-m4a',Buffer.alloc(0)),'audio/mp4');assert.equal(audioType('application/octet-stream',Buffer.from('RIFF0000WAVEfixture')),'audio/wav');assert.equal(audioType('application/octet-stream',Buffer.from('ID3fixture')),'audio/mpeg');assert.equal(audioType('text/html',Buffer.from('ID3fixture')),null);assert.equal(audioType('application/octet-stream',Buffer.from('<html>')),null);});
test('single byte ranges support browser start, suffix and seeking, invalid ranges fail closed',()=>{assert.deepEqual(audioRange('bytes=0-1',10),{start:0,end:1});assert.deepEqual(audioRange('bytes=4-',10),{start:4,end:9});assert.deepEqual(audioRange('bytes=-3',10),{start:7,end:9});for(const h of ['bytes=20-','bytes=5-2','bytes=0-1,4-5','bytes=-','bytes=-0','garbage'])assert.equal(audioRange(h,10),false);});
test('binary recording download never forwards credentials and a partial provider body is rejected',async()=>{let n=0;const service=createRinkelMedia({key:'fixture',allowedNumbers:number,fetcher:async(u,o)=>{if(++n===1)return response(record);if(n===2)return response({url:'https://api.rinkel.com/audio/call-recording/fixture?token=fixture'});assert.equal(new URL(u).searchParams.get('download'),'true');assert.equal(o.headers,undefined);return new Response('RIFF0000WAVEfixture',{headers:{'content-type':'application/octet-stream'}});}});assert.equal((await service.audio(call)).type,'audio/wav');n=0;const partial=createRinkelMedia({key:'fixture',allowedNumbers:number,fetcher:async()=>++n===1?response(record):n===2?response({url:'https://api.rinkel.com/audio/call-recording/fixture'}):new Response('ID3fixture',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-9/1000'}})});await assert.rejects(partial.audio(call),e=>e.reishuisSafe&&!e.message.includes('token'));});

test('audio accepts validated top-level or wrapped signed URL and reports safe source failures',async()=>{
 for(const body of [{url:'https://api.rinkel.com/audio/call-recording/fixture?token=fixture'},{data:'https://api.rinkel.com/audio/call-recording/fixture?token=fixture'}]){let n=0;const service=createRinkelMedia({key:'fixture',allowedNumbers:number,fetcher:async()=>++n===1?response(record):n===2?new Response(JSON.stringify(body)):new Response('audio',{headers:{'content-type':'audio/mpeg'}})});assert.equal((await service.audio(call)).type,'audio/mpeg');}
 for(const source of [{}, {url:'https://foreign.test/private?token=secret'}]){let n=0;const service=createRinkelMedia({key:'fixture',allowedNumbers:number,fetcher:async()=>response(++n===1?record:source)});await assert.rejects(service.audio(call),e=>e.reishuisSafe===true&&!e.message.includes('secret')&&!e.message.includes('foreign'));}
});
