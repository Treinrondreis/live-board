// Original-photo archive. Drive OAuth remains inside the private storage service.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {kkGet,kkPut,kkDelete,kkAcquireUploadLease,kkReleaseUploadLease,kkPhotoArchiveRows,kkPhotoArchiveCounts,kkPhotoArchiveRetry} from './kk-store.mjs';
import {testEdition} from './kk-edition-context.mjs';

const MAX=15_000_000,PHOTO=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,OWNER=/^[a-f0-9]{64}$/;
const fail=message=>{throw Object.assign(Error(message),{status:503});};
export function photoArchiveIdentity(owner,id){if(!OWNER.test(owner)||!PHOTO.test(id))throw Error('Ongeldige fotoverwijzing.');return createHash('sha256').update('2026/'+owner+'/'+id).digest('hex');}
export async function boundedPhoto(stream,limit=MAX){let size=0;const parts=[];for await(const part of stream){const chunk=Buffer.from(part);size+=chunk.length;if(size>limit)throw Error('Foto is te groot of onvolledig.');parts.push(chunk);}return Buffer.concat(parts);}
const fingerprints=raw=>({size:raw.length,md5:createHash('md5').update(raw).digest('hex'),sha256:createHash('sha256').update(raw).digest('hex')});

export function createPhotoArchive({get=kkGet,put=kkPut,remove=kkDelete,lease=kkAcquireUploadLease,release=kkReleaseUploadLease,candidates=kkPhotoArchiveRows,counts=kkPhotoArchiveCounts,retry=kkPhotoArchiveRetry,
 configuration=()=>({upstream:process.env.BOOKLETS_INTERNAL_URL,secret:process.env.BOOKLETS_GATEWAY_SECRET}),fetcher=(...a)=>fetch(...a),now=()=>Date.now(),isTest=testEdition,
 readS3=async(o,i)=>(await import('./kk-media.mjs')).storedS3MediaStream(o,i),headS3=async(o,i)=>(await import('./kk-media.mjs')).inspectStoredMedia(o,i),
 deleteS3=async(o,i)=>(await import('./kk-media.mjs')).deleteS3Media(o,i),ensurePreview=async row=>{await (await import('./kk-preview.mjs')).previewMedia(row);return get('media',row.id);}}={}){
 let running=null,starting=false,paused=false,done=0,errors=0,lastError='',lastPhoto=null;
 function config(){const c=configuration();if(!c.upstream||!c.secret||c.secret.length<32)fail('De privéverbinding voor het fotoarchief is nog niet ingesteld.');const u=new URL(c.upstream);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)fail('Ongeldige archiefverbinding.');return {...c,base:u.origin};}
 async function request(path,{body,method='GET',headers={}}={}){
  const c=config();let response;try{response=await fetcher(c.base+'/internal/km-archive/'+path,{method,headers:{'X-Booklets-Gateway':c.secret,...headers},...(body!==undefined?{body}:{}),redirect:'error',signal:AbortSignal.timeout(110000)});}catch{fail('Het fotoarchief is tijdelijk niet bereikbaar. De hostingkopie blijft behouden.');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});fail(response.status===429?'Het fotoarchief is bezig. De overdracht kan opnieuw worden gestart.':'Het fotoarchief heeft de actie niet bevestigd. De hostingkopie blijft behouden.');}
  return response;
 }
 async function json(path,options){const r=await request(path,options);return JSON.parse((await boundedPhoto(r.body,16000)).toString());}
 const sign=(owner,id,until)=>createHmac('sha256',config().secret).update('km-photo-archive-v1\0'+owner+'\0'+id+'\0'+until).digest('hex');
 async function original(owner,id){const row=await get('media',id);if(!row||row.owner!==owner||row.value.kind!=='image')return null;const p=await get('participant',owner);if(p?.value.deleting)return null;return row;}
 async function mapping(owner,id){const row=await get('media-drive',id);if(!row||row.owner!==owner||!['verified','removed'].includes(row.value.status))return null;if(!await original(owner,id))return null;if(row.value.key!==photoArchiveIdentity(owner,id))fail('Archiefverwijzing klopt niet.');return row.value;}
 async function url(owner,id){if(isTest())return null;if(!await mapping(owner,id))return null;const until=now()+120000;return '/kilometerkampioen/api/archived-photo?'+new URLSearchParams({owner,id,until:String(until),signature:sign(owner,id,until)});}
 async function bytes(owner,id){const item=await mapping(owner,id);if(!item)return null;const response=await request('photo/'+item.key),raw=await boundedPhoto(response.body);if(raw.length!==item.size||createHash('sha256').update(raw).digest('hex')!==item.sha256)fail('De opgehaalde archieffoto wijkt af. Probeer opnieuw.');return {raw,type:item.type};}
 async function signedBytes(params){
  const owner=params.get('owner')||'',id=params.get('id')||'',until=Number(params.get('until')),signature=params.get('signature')||'';
  if(isTest()||!OWNER.test(owner)||!PHOTO.test(id)||!Number.isSafeInteger(until)||until<=now()||until>now()+120000||! /^[a-f0-9]{64}$/.test(signature))throw Object.assign(Error('Fotolink is ongeldig of verlopen.'),{status:403});
  if(!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(owner,id,until))))throw Object.assign(Error('Fotolink is ongeldig of verlopen.'),{status:403});
  const result=await bytes(owner,id);if(!result)throw Object.assign(Error('Foto niet gevonden.'),{status:404});return result;
 }
 async function trashRemote(key){await json('photo/'+key+'/trash',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});}
 async function deleteArchived(owner,id){
  if(isTest())return false;const source=await get('media',id),m=await get('media-drive',id);if(!m&&source?.value.kind!=='image')return false;if((m&&m.owner!==owner)||(source&&source.owner!==owner))fail('Deze archieffoto hoort bij een andere eigenaar.');
  const nonce=randomUUID(),key='photo-archive:'+id;if(!await lease(key,owner,nonce))fail('Deze foto wordt overgezet. Probeer verwijderen zo opnieuw.');
  try{const latest=await get('media-drive',id);if(latest?.value.key)await trashRemote(latest.value.key);await deleteS3(owner,id);if(latest)await remove('media-drive',id);return true;}finally{await release(key,nonce);}
 }
 async function one(input){
  const owner=input.owner,id=input.id,key=photoArchiveIdentity(owner,id),nonce=randomUUID(),lock='photo-archive:'+id;
  if(!await lease(lock,owner,nonce))return false;
  let transferred=false;
  try{
   let current=await original(owner,id);if(!current)return false;
   const previous=await get('media-drive',id);if(previous?.value.status==='removed')return false;
   if(previous?.value.status==='verified'){
    const saved=previous.value;await bytes(owner,id);
    let head;try{head=await headS3(owner,id);}catch(e){if(e.name!=='NotFound'&&e.name!=='NoSuchKey'&&e.$metadata?.httpStatusCode!==404)throw e;}
    if(head){const raw=await boundedPhoto(await readS3(owner,id));if(fingerprints(raw).sha256!==saved.sha256)fail('De hostingfoto is gewijzigd en blijft behouden.');await deleteS3(owner,id);}
    await put('media-drive',id,owner,{...saved,status:'removed',retryBlocked:false});return true;
   }
   if(!current.value.previewId){current=await ensurePreview(current);if(!current?.value.previewId)fail('Een voorbeeldfoto kon niet worden gemaakt; het origineel blijft behouden.');}
   await headS3(owner,current.value.previewId);
   const before=await headS3(owner,id);if(Number(before.ContentLength)!==Number(current.value.size))fail('De hostingfoto heeft een andere grootte en blijft behouden.');
   const raw=await boundedPhoto(await readS3(owner,id)),digest=fingerprints(raw);
   if(digest.size!==Number(current.value.size)||!current.value.type?.startsWith('image/'))fail('De hostingfoto is niet volledig ontvangen.');
   const response=await json('photo/'+key,{method:'POST',body:raw,headers:{'Content-Type':current.value.type,'Content-Length':String(raw.length),'X-KM-Owner':owner,'X-KM-Photo':id,'X-KM-MD5':digest.md5,'X-KM-SHA256':digest.sha256}});
   if(!response.verified||response.id!==key||response.sha256!==digest.sha256||response.md5!==digest.md5||response.size!==digest.size||response.type!==current.value.type)fail('De kopie in Drive is niet bevestigd. Het hostingbestand blijft behouden.');
   transferred=true;
   if(!await original(owner,id)){await trashRemote(key);return false;}
   const value={key,...digest,type:current.value.type,status:'verified'};
   // Switch reads only after Drive confirmation; commit before S3 eviction.
   await put('media-drive',id,owner,value);
   const after=await headS3(owner,id);
   if(after.ETag!==before.ETag||Number(after.ContentLength)!==digest.size)fail('De hostingfoto is gewijzigd en blijft daarom behouden.');
   await deleteS3(owner,id);
   await put('media-drive',id,owner,{...value,status:'removed'});
   return true;
  }catch(e){
   const current=await original(owner,id);
   if(current){const old=await get('media-drive',id);await put('media-drive',id,owner,{...(old?.value||{}),...(transferred?{}:{key}),status:old?.value.status==='verified'?'verified':'error',retryBlocked:true});}
   throw e;
  }finally{await release(lock,nonce);}
 }
 async function status(){const settings=await get('media-archive-settings','2026');return {...await counts(),running:!!running||starting,paused,done,errors,error:lastError,lastPhoto,folderName:'KMtein26',folderUrl:settings?.value.folderUrl||null};}
 async function start({limit=0}={}){
  if(isTest())throw Object.assign(Error('Het fotoarchief geldt alleen voor de echte editie van 2026.'),{status:400});
  if(running||starting)return status();starting=true;paused=false;done=0;errors=0;lastError='';let consecutiveErrors=0;
  try{
  const setup=await json('setup',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}}),sizes=await counts();
  if(setup.freeBytes!==null&&setup.freeBytes<sizes.bytes-sizes.freed+50_000_000)fail('Er is onvoldoende vrije Google Drive-opslag voor de resterende foto’s.');
  await put('media-archive-settings','2026','system',{folderUrl:setup.folderUrl,folderName:setup.folderName});
  await retry();
  // Each completed photo is committed. A restart or stop can resume safely.
  running=(async()=>{try{
   while(!paused){const rows=await candidates(limit===1?1:8);if(!rows.length)break;
    for(let offset=0;offset<rows.length&&!paused;offset+=2){await Promise.all(rows.slice(offset,offset+2).map(async row=>{try{if(await one(row)){done++;lastPhoto=row.id;consecutiveErrors=0;}else paused=true;}catch{errors++;consecutiveErrors++;lastError='Een foto kon niet worden overgezet. De oorspronkelijke hostingkopie blijft behouden; overige foto’s gaan verder.';if(consecutiveErrors>=3){paused=true;lastError='Overdracht gepauzeerd na meerdere fouten. Bestaande foto’s blijven behouden. Probeer later opnieuw.';}}}));if(limit&&done+errors>=limit){paused=true;break;}}
   }
  }catch{lastError='De overdracht is onderbroken. U kunt later veilig hervatten.';}finally{running=null;}})();
  return status();
  }finally{starting=false;}
 }
 return {one,status,start,pause(){paused=true;return status();},url,bytes,signedBytes,deleteArchived};
}

export const photoArchive=createPhotoArchive();
export const archivedPhotoUrl=(owner,id)=>photoArchive.url(owner,id);
export async function archivedPhotoStream(owner,id){if(testEdition())return null;const result=await photoArchive.bytes(owner,id);return result?Readable.from([result.raw]):null;}
