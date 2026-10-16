import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {createPhotoArchive,photoArchiveIdentity} from './kk-photo-drive.mjs';
import {initKKStore,kkPut,kkPhotoArchiveRows,kkPhotoArchiveCounts,kkPhotoArchiveRetry} from './kk-store.mjs';
import {withTestEdition} from './kk-edition-context.mjs';

const owner='a'.repeat(64),id='11111111-1111-4111-8111-111111111111',preview='22222222-2222-4222-8222-222222222222';
const raw=Buffer.from('synthetic-photo-only'),md5=b=>createHash('md5').update(b).digest('hex'),sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const rows=new Map(),s3=new Map([[id,raw],[preview,Buffer.from('synthetic-preview')]]),remote=new Map(),events=[],locks=new Set();let clock=1000,uploads=0,corrupt=false,putFailure=false;
 const get=async(kind,key)=>structuredClone(rows.get(kind+':'+key)||null),put=async(kind,key,who,value)=>{if(putFailure&&kind==='media-drive'&&value.status==='removed'){putFailure=false;throw Error('Synthetic commit failure');}rows.set(kind+':'+key,{id:key,owner:who,value:structuredClone(value)});events.push(kind+':'+(value.status||''));};
 rows.set('media:'+id,{id,owner,value:{kind:'image',type:'image/jpeg',size:raw.length,previewId:preview}});
 const headS3=async(who,key)=>{assert.equal(who,owner);if(!s3.has(key))throw Object.assign(Error('Synthetic missing'),{name:'NotFound'});return {ContentLength:s3.get(key).length,ETag:md5(s3.get(key))};};
 const dependencies={get,put,remove:async(k,i)=>rows.delete(k+':'+i),lease:async key=>{if(locks.has(key))return false;locks.add(key);return true;},release:async key=>locks.delete(key),
  configuration:()=>({upstream:'http://storage.internal',secret:'synthetic-secret-'.repeat(4)}),now:()=>clock,isTest:()=>false,
  readS3:async(who,key)=>Readable.from([s3.get(key)]),headS3,deleteS3:async(who,key)=>{assert.equal(who,owner);events.push('delete-s3');s3.delete(key);},
  ensurePreview:async row=>row,
  counts:async()=>({total:[...rows.values()].filter(r=>r.value.kind==='image').length,bytes:raw.length,archived:[...rows.values()].filter(r=>r.value.status==='removed').length,freed:0}),
  candidates:async limit=>[...rows.values()].filter(r=>r.value.kind==='image'&&!['removed','error'].includes(rows.get('media-drive:'+r.id)?.value.status)&&!rows.get('media-drive:'+r.id)?.value.retryBlocked).slice(0,limit),
  retry:async()=>{for(const row of rows.values())if(row.value.retryBlocked){row.value.retryBlocked=false;if(row.value.status==='error')row.value.status='pending';}},
  fetcher:async(url,opts)=>{
   assert.ok(url.startsWith('http://storage.internal/internal/km-archive/'));assert.equal(opts.redirect,'error');assert.ok(opts.headers['X-Booklets-Gateway']);
   if(url.endsWith('/setup'))return Response.json({folderName:'KMtein26',folderUrl:'https://drive.google.com/drive/folders/synthetic-folder',freeBytes:1e9});
   const key=url.split('/photo/')[1].split('/')[0];
   if(url.endsWith('/trash')){events.push('trash-drive');remote.delete(key);return Response.json({ok:true});}
   if(opts.method==='POST'){uploads++;const value={verified:true,id:key,size:opts.body.length,sha256:sha(opts.body),md5:md5(opts.body),type:opts.headers['Content-Type']};remote.set(key,Buffer.from(opts.body));events.push('upload-drive');return Response.json({...value,...(corrupt?{sha256:'wrong'}:{})});}
   return new Response(remote.get(key));
  }};
 const archive=createPhotoArchive(dependencies);
 return {archive,rows,s3,remote,events,dependencies,get,put,uploads:()=>uploads,clock:v=>clock=v,corrupt:v=>corrupt=v,failCommit:()=>putFailure=true};
}

test('original moves only after Drive verification; preview and source metadata remain',async()=>{
 const f=fixture();assert.equal(await f.archive.one(await f.get('media',id)),true);assert.equal(f.s3.has(id),false);assert.equal(f.s3.has(preview),true);assert.equal((await f.get('media',id)).value.size,raw.length);
 assert.ok(f.events.indexOf('media-drive:verified')<f.events.indexOf('delete-s3'));assert.equal((await f.get('media-drive',id)).value.status,'removed');
 const link=await f.archive.url(owner,id);const loaded=await f.archive.signedBytes(new URL(link,'https://example.org').searchParams);assert.deepEqual(loaded.raw,raw);assert.equal(loaded.type,'image/jpeg');
});
test('wrong Drive digest keeps S3 source and never switches reads',async()=>{
 const f=fixture();f.corrupt(true);await assert.rejects(f.archive.one(await f.get('media',id)),/niet bevestigd/);assert.equal(f.s3.has(id),true);assert.equal(await f.archive.url(owner,id),null);assert.equal((await f.get('media-drive',id)).value.status,'error');
});
test('failure committing removed status resumes after deletion without reuploading or losing access',async()=>{
 const f=fixture();f.failCommit();await assert.rejects(f.archive.one(await f.get('media',id)),/Synthetic/);assert.equal(f.s3.has(id),false);assert.equal((await f.get('media-drive',id)).value.status,'verified');
 assert.deepEqual((await f.archive.bytes(owner,id)).raw,raw);assert.equal(await f.archive.one(await f.get('media',id)),true);assert.equal(f.uploads(),1);assert.equal((await f.get('media-drive',id)).value.status,'removed');
});
test('signed photo links reject tampering, expiry, changed owner and deletion without remote reads',async()=>{
 const f=fixture();await f.archive.one(await f.get('media',id));const link=await f.archive.url(owner,id),params=new URL(link,'https://example.org').searchParams;
 params.set('owner','b'.repeat(64));await assert.rejects(f.archive.signedBytes(params),/ongeldig/);params.set('owner',owner);f.clock(122000);await assert.rejects(f.archive.signedBytes(params),/verlopen/);f.clock(1000);
 f.rows.delete('media:'+id);await assert.rejects(f.archive.signedBytes(params),/niet gevonden/);assert.equal(await f.archive.url(owner,id),null);
 assert.throws(()=>photoArchiveIdentity('../private',id),/Ongeldige/);
});
test('participant deletion and archiving share a lease and do not resurrect deleted photo records',async()=>{
 const f=fixture(),originalFetch=f.dependencies.fetcher;let entered,finish;const started=new Promise(r=>entered=r),wait=new Promise(r=>finish=r);
 const archive=createPhotoArchive({...f.dependencies,fetcher:async(...args)=>{if(args[1].method==='POST'&&!args[0].endsWith('/trash')){entered();await wait;}return originalFetch(...args);}});
 const moving=archive.one(await f.get('media',id));await started;await assert.rejects(archive.deleteArchived(owner,id),/wordt overgezet/);
 await f.put('participant',owner,owner,{deleting:true});finish();assert.equal(await moving,false);assert.equal(f.s3.has(id),true);assert.equal(await f.get('media-drive',id),null);assert.equal(f.remote.size,0);
});
test('deletion trashes its exact Drive copy before removing source and mapping',async()=>{
 const f=fixture();await f.archive.one(await f.get('media',id));f.events.length=0;await f.archive.deleteArchived(owner,id);
 assert.deepEqual(f.events,['trash-drive','delete-s3']);assert.equal(f.remote.size,0);assert.equal(await f.get('media-drive',id),null);
 const untouched=fixture();assert.equal(await untouched.archive.deleteArchived(owner,id),true);assert.equal(untouched.s3.has(id),false);assert.equal(untouched.remote.size,0);
});
test('one-photo trial stops after one and failing photos do not create an endless queue',async()=>{
 const f=fixture();await f.archive.start({limit:1});for(let i=0;i<30&&(await f.archive.status()).running;i++)await new Promise(r=>setImmediate(r));assert.equal((await f.archive.status()).archived,1);
 const g=fixture();g.corrupt(true);await g.archive.start();for(let i=0;i<30&&(await g.archive.status()).running;i++)await new Promise(r=>setImmediate(r));const result=await g.archive.status();assert.equal(result.running,false);assert.equal(result.errors,1);assert.equal(g.s3.has(id),true);
 g.corrupt(false);await g.archive.start();for(let i=0;i<30&&(await g.archive.status()).running;i++)await new Promise(r=>setImmediate(r));assert.equal((await g.archive.status()).archived,1);
});
test('SQL candidates are not capped at 200; only live images are selected and pending deletions are excluded',async()=>{
 const sqlite=new DatabaseSync(':memory:');await initKKStore({sqlite});
 for(let n=0;n<225;n++)await kkPut('media',String(n),owner,{kind:'image',size:10});
 await kkPut('media','video',owner,{kind:'video',size:50});await kkPut('media-drive','0',owner,{status:'removed'});await kkPut('media-drive','1',owner,{status:'error',retryBlocked:true});
 assert.equal((await kkPhotoArchiveCounts()).total,225);assert.equal((await kkPhotoArchiveCounts()).archived,1);assert.equal((await kkPhotoArchiveRows(50)).length,50);assert.ok(!(await kkPhotoArchiveRows(50)).some(r=>['0','1','video'].includes(r.id)));
 await kkPhotoArchiveRetry();assert.ok((await kkPhotoArchiveRows(50)).some(r=>r.id==='1'));await kkPut('participant',owner,owner,{deleting:true});assert.equal((await kkPhotoArchiveRows()).length,0);
 await withTestEdition({network:{revision:'synthetic'}},async()=>{assert.equal((await kkPhotoArchiveCounts()).total,0);});sqlite.close();
});
