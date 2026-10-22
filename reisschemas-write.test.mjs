import test from 'node:test';
import assert from 'node:assert/strict';
import {createReisschemasHandler} from './reisschemas.mjs';
import {changeKey} from './reisschema-changes.mjs';
const version='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
const observation={departure_date:'2031-06-10',departure_time:'09:56',arrival_date:'2031-06-10',arrival_time:'12:10',cancelled:false,connection_broken:false,backup_communicated:false,source:'Fictional source',observed_at:'2020-06-02T12:00:00Z'};
const row={version_id:version,leg_id:id,sequence:1,role:'primary',train_number:'TEST 700',travel_date:'2031-06-10',arrival_date:'2031-06-10',departure_time:'10:00',arrival_time:'12:00',from_station:'Example North',to_station:'Example South',observation};
async function request({signedIn=true,origin='https://example.invalid',path='communication',data={},extraHeaders={}}={}){
 const calls=[];let status,body;
 const handler=createReisschemasHandler({authenticate:async()=>signedIn,lookupPlans:async()=>[],register:{summary:async()=>({configured:true,available:true,legs:[row]}),recordLegEvent:async(...args)=>{calls.push(args);return {event_id:'fictional'};}}});
 const req={method:'POST',headers:{host:'example.invalid',origin,'content-type':'application/json','x-reisschemas':'1',...extraHeaders},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}};
 await handler(req,{setHeader(){},writeHead(code){status=code;},end(v){body=JSON.parse(v);}},new URL('/seinhuis/reisschemas/api/'+path,'https://example.invalid'));
 return {status,body,calls};
}
const communication=()=>({versionId:version,legId:id,changeKey:changeKey(id,observation),communicatedAt:'2020-06-02T13:00:00Z',method:'email',reference:'Fictional internal reference',requestId:'fictional-request'});
test('authentication, origin and custom request header precede every write',async()=>{
 assert.equal((await request({signedIn:false})).status,401);
 for(const overrides of [{origin:'https://foreign.invalid'},{extraHeaders:{'x-reisschemas':'0'}},{extraHeaders:{'content-type':'text/plain'}}]){
  const r=await request({...overrides,data:communication()});assert.equal(r.status,403);assert.equal(r.calls.length,0);
 }
});
test('only the current displayed change can be marked communicated and baseline is never rewritten',async()=>{
 const stale=await request({data:{...communication(),changeKey:'older'}});assert.equal(stale.status,409);assert.equal(stale.calls.length,0);
 const other=await request({data:{...communication(),legId:'other'}});assert.equal(other.status,409);assert.equal(other.calls.length,0);
 const valid=await request({data:communication()});assert.equal(valid.status,200);assert.equal(valid.calls.length,2);assert.equal(valid.calls[0][1],'observation');assert.equal(valid.calls[1][1],'communication');assert.equal(valid.calls[1][2].change_key,changeKey(id,observation));
 assert.equal(row.departure_time,'10:00');
});
test('malformed communication is rejected before even recording the observation',async()=>{
 for(const changes of [{requestId:null},{method:'send-email'},{communicatedAt:'not a time'},{actor:'forged'}]){
  const r=await request({data:{...communication(),...changes}});assert.equal(r.status,400);assert.equal(r.calls.length,0);
 }
});
