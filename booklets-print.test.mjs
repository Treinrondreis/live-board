import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBookletPrinter,printSettings,printAddress,printPrice} from './booklets-print.mjs';

const id='a'.repeat(32),bytes=Buffer.from('%PDF synthetic fixture'),sha=createHash('sha256').update(bytes).digest('hex');
const address={contact:'Demo Reiziger',street:'Voorbeeldstraat',number:'10',number_ext:'',postalcode:'1000AA',city:'Voorbeeldstad',country:'NL'};
const settings={copies:2,paper:'100',cover:'250',color:'all',production:'standard',address};
const response=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
function fixture(){
 const f={quotes:new Map(),record:null,calls:[],changed:false,uploadFailure:false,postFailure:false,rejected:false,remote:null,time:1_000_000,token:'synthetic-token',meta:{id,bookId:'demo-book',bookingId:'demo-booking',title:'Demo booklet',pages:20,size:bytes.length,sha256:sha}};
 f.fetcher=async(url,init)=>{
  const path=new URL(url).pathname,body=typeof init.body==='string'?JSON.parse(init.body):null;f.calls.push({path,body,headers:init.headers});
  if(path.startsWith('/internal/print-orders/')){
   assert.equal(init.headers['X-Booklets-Gateway'],'s'.repeat(48));assert.equal(init.redirect,'error');const action=path.split('/').at(-1);
   if(action==='metadata')return Response.json(f.meta);
   if(action==='record')return Response.json(f.record);
   if(action==='quote'){f.quotes.set(body.quote.id,structuredClone(body.quote));return Response.json({ok:true});}
   if(action==='get-quote')return Response.json(f.quotes.get(body.quoteId));
   if(action==='claim'){if(f.record&&!['upload_failed','rejected'].includes(f.record.state))return Response.json({claimed:false,...f.record});f.record={export_id:id,quote_id:body.quoteId,state:'uploading',payload:{reference:'TRR-'+id,totalCents:1452,environment:'live'}};return Response.json({claimed:true});}
   if(action==='update'){f.record.state=body.state;Object.assign(f.record.payload,body.receipt);return Response.json({ok:true});}
   if(action==='pdf')return new Response(bytes,{headers:{'Content-Length':String(bytes.length),'Content-Type':'application/pdf'}});
   throw Error('Unknown private action');
  }
  assert.equal(new URL(url).origin,'https://www.printenbind.nl');assert.equal(init.headers.Authorization,'Bearer '+f.token);assert.equal(init.redirect,'error');
  if(['/api/rest/orders/calculate','/api/rest/orders'].includes(path)){assert(Array.isArray(body.articles));assert(body.articles.every(a=>a&&typeof a==='object'&&!Array.isArray(a)),'articles must contain JSON objects, never encoded JSON strings');}
  if(path==='/api/rest/orders/calculate')return response({amount:f.changed?13:12,delivery_amount:3,amount_tax_reduced:0,amount_tax_standard:2.52,delivery_at:'2026-10-21'});
  if(path==='/api/rest/documents'){
   if(f.uploadFailure)throw Error('Unavailable');let all=[];for await(const chunk of init.body)all.push(chunk);const raw=Buffer.concat(all),filename=raw.toString().match(/filename="([^"]+)"/)[1];assert(raw.includes(bytes));assert.equal(Number(init.headers['Content-Length']),raw.length);return response({name:filename,size:bytes.length});
  }
  if(path==='/api/rest/orders'){
   if(f.rejected)return new Response('{}',{status:422});f.remote={id:123,status:'Aangemaakt',reference:body.reference};if(f.postFailure)throw Error('Response lost');return response(f.remote);
  }
  if(path==='/api/rest/orders/search'||path==='/api/rest/orders/123')return f.remote?response(f.remote):new Response('{}',{status:404});
  throw Error('Unexpected endpoint');
 };
 f.printer=()=>createBookletPrinter({fetcher:f.fetcher,now:()=>f.time,bookings:{address:async b=>{assert.equal(b.bookingId,'demo-booking');return {firstName:'Demo',lastName:'Reiziger',address:'Voorbeeldstraat 10 B',postalCode:'1000AA',city:'Voorbeeldstad',country:'nederland'};}},configuration:()=>({token:f.token,environment:'live',upstream:'http://private.example',secret:'s'.repeat(48)})});
 f.api=f.printer();return f;
}

test('magazine defaults, inclusive tax/shipping and explicit international country handling',()=>{
 const p=printSettings(settings,20),a=p.articles[0];assert.equal(p.delivery_method,'post');assert.equal(p.delivery_option,undefined);assert.equal(a.product,'tijdschrift');assert.equal(a.finishing,'folding-stapling');assert.equal(a.folding,'middle_long');assert.equal(a.finishing_extra,'none');assert.equal(a.number,2);assert.equal(a.copies,20);assert.equal(a.printside_back,1);assert.equal(a.papertype_cover,'250');assert.equal(a.papertype,'100');
 const be=printSettings({...settings,address:{...address,country:'België',postalcode:'1000'}},20);assert.equal(be.country,'BE');assert.equal(be.delivery_method,'international');assert.equal(be.delivery_option,undefined);
 assert.throws(()=>printSettings({...settings,address:{...address,country:''}},20),/land/);assert.throws(()=>printSettings({...settings,address:{...address,country:'DE'}},20),/postcode/);assert.throws(()=>printSettings(settings,19),/vier/);
 const split=printAddress({firstName:'Demo',address:'Voorbeeldstraat 10 B',country:'nederland'});assert.equal(split.number,'10');assert.equal(split.number_ext,'B');assert.equal(split.country,'NL');
 assert.equal(printPrice({amount:12,delivery_amount:3,amount_tax_reduced:0,amount_tax_standard:2.52}).totalCents,1452);assert.throws(()=>printPrice({amount:12}),/prijs/);
});
test('preparation reads exact booking, quotes do not upload or order, client cannot supply page count',async()=>{
 const f=fixture(),p=await f.api.prepare({exportId:id});assert.equal(p.address.country,'NL');assert.equal(p.defaults.cover,'250');
 const q=await f.api.quote({exportId:id,settings,pages:999});assert.equal(q.price.totalCents,1452);assert.equal(f.calls.find(c=>c.path.endsWith('/calculate')).body.articles[0].copies,20);
 assert(!f.calls.some(c=>c.path==='/api/rest/orders'||c.path==='/api/rest/documents'));assert(!JSON.stringify(q).includes(f.token));
 await assert.rejects(f.api.order({exportId:id,quoteId:q.id}),/Bevestig/);
});
test('changed price, expired quote, changed PDF and rotated credentials block ordering',async()=>{
 for(const change of ['price','expiry','pdf','token']){const f=fixture(),q=await f.api.quote({exportId:id,settings});if(change==='price')f.changed=true;if(change==='expiry')f.time+=20*60000;if(change==='pdf')f.meta.sha256='0'.repeat(64);if(change==='token')f.token='another-synthetic-token';await assert.rejects(f.api.order({exportId:id,quoteId:q.id,confirmed:true}));assert(!f.calls.some(c=>c.path==='/api/rest/documents'||c.path==='/api/rest/orders'));}
});
test('confirmed exact PDF uploads once, duplicate simultaneous clicks cannot create duplicate orders',async()=>{
 const f=fixture(),q=await f.api.quote({exportId:id,settings}),request={exportId:id,quoteId:q.id,confirmed:true};await Promise.all([f.api.order(request),f.api.order(request)]);await f.api.order(request);
 assert.equal(f.calls.filter(c=>c.path==='/api/rest/orders').length,1);assert.equal(f.calls.filter(c=>c.path==='/api/rest/documents').length,1);assert.equal(f.record.state,'placed');
 const article=f.calls.find(c=>c.path==='/api/rest/orders').body.articles[0];assert.equal(article.number,2);assert.equal(article.copies,20);assert.equal(article.printside_back,1);assert.equal(article.add_file_method,'upload');assert.match(article.filenames,/^reisboekje-[a-f0-9-]+\.pdf$/);assert.equal(article.file_url,undefined);
});
test('lost order response is reconciled by unique reference after restart, never resubmitted',async()=>{
 const f=fixture(),q=await f.api.quote({exportId:id,settings});f.postFailure=true;await f.api.order({exportId:id,quoteId:q.id,confirmed:true});assert.equal(f.record.state,'placed');await f.printer().order({exportId:id,quoteId:q.id,confirmed:true});assert.equal(f.calls.filter(c=>c.path==='/api/rest/orders').length,1);
});
test('unknown order outcome stays blocked; known rejected order and upload failure can be corrected',async()=>{
 const f=fixture(),q=await f.api.quote({exportId:id,settings});f.record={quote_id:q.id,state:'uncertain',payload:{reference:'TRR-'+id,environment:'live'}};await f.api.order({exportId:id,quoteId:q.id,confirmed:true});assert(!f.calls.some(c=>c.path==='/api/rest/orders'));
 for(const kind of ['uploadFailure','rejected']){const g=fixture(),quote=await g.api.quote({exportId:id,settings});g[kind]=true;await assert.rejects(g.api.order({exportId:id,quoteId:quote.id,confirmed:true}));assert.equal(g.record.state,kind==='rejected'?'rejected':'upload_failed');g[kind]=false;await g.api.order({exportId:id,quoteId:quote.id,confirmed:true});assert.equal(g.record.state,'placed');}
});

test('printer field names keep independently chosen quantities separate from verified PDF pages',()=>{
 const request=printSettings({...settings,copies:7},40),article=request.articles[0];
 // Print&Bind product catalogue: number = oplage, copies = pagina's.
 assert.equal(article.number,7);assert.equal(article.copies,40);assert.equal(article.printside_back,1);
 assert.equal(article.printside,'double');assert.equal(article.finishing_cover,'none');
});