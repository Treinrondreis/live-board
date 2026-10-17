import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRinkelMedia} from './reishuis-rinkel-media.mjs';
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
