import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {sanityConfig} from './flora-sanity.mjs';

export function normalizePhone(value,country=''){
 if(typeof value!=='string'||!/^[+\d\s().-]+$/.test(value))return null;
 let v=value.replace(/[\s().-]/g,'');if(v.startsWith('00'))v='+'+v.slice(2);
 if(!v.startsWith('+')){
  const prefixes={nl:'31',nederland:'31',netherlands:'31',be:'32',belgie:'32',belgium:'32',de:'49',duitsland:'49',germany:'49',fr:'33',frankrijk:'33',france:'33',gb:'44','verenigd-koninkrijk':'44',uk:'44'};
  const prefix=prefixes[String(country).toLowerCase()];if(!prefix||!v.startsWith('0'))return null;v='+'+prefix+v.slice(1);
 }
 return /^\+[1-9]\d{7,14}$/.test(v)?v:null;
}
export async function fetchPhoneIndex({fetcher=fetch,config=sanityConfig()}={}){
 if(!config.token||config.project!=='il9cyh3m'||config.dataset!=='production')throw Error('Read-only phone connection unavailable');
 const rows=new Map();let after='';
 for(let page=0;page<1000;page++){
  const u=new URL('https://il9cyh3m.api.sanity.io/v2026-10-03/data/query/production');u.searchParams.set('query','*[_type == "tourBooking" && _id > $after] | order(_id asc)[0...500]{_id,phone,country}');u.searchParams.set('$after',JSON.stringify(after));u.searchParams.set('perspective','raw');
  const r=await fetcher(u,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Phone read failed');const {result}=await r.json();if(!Array.isArray(result))throw Error('Invalid phone response');
  for(const row of result){if(typeof row._id!=='string')throw Error('Invalid phone record');const id=row._id.replace(/^drafts\./,'');if(!rows.has(id)||row._id.startsWith('drafts.'))rows.set(id,{id,phone:row.phone,country:row.country});}
  if(result.length<500)return [...rows.values()];const next=result.at(-1)?._id;if(typeof next!=='string'||next<=after)throw Error('Invalid phone cursor');after=next;
 }
 throw Error('Phone page limit reached');
}
// One production replica. Temporary call notices and phone digests live only in
// bounded process memory. No audio, call history, raw caller numbers or API key.
export function createRinkelIncoming({secret=process.env.RINKEL_WEBHOOK_SECRET||'',allowedNumbers=process.env.RINKEL_ALLOWED_NUMBERS||'',enabled=process.env.RINKEL_INCOMING_ENABLED==='1',fetchPhones=fetchPhoneIndex,clock=Date.now}={}){
 const allowed=new Set(String(allowedNumbers).split(',').map(n=>normalizePhone(n)).filter(Boolean));
 const configured=enabled&&/^[a-f0-9]{64}$/.test(secret)&&allowed.size>0,instance=randomUUID();let counter=0,events=[],historical=new Map(),seen=new Map(),index=null,pending,retry=0,loadedAt=0,failed=false;
 const hash=number=>createHmac('sha256',secret).update('rinkel-phone-v1\0'+number).digest('hex');
 const prune=()=>{const now=clock();events=events.filter(e=>now-e.at<1800000);for(const [id,e] of historical)if(now-e.loadedAt>=1800000)historical.delete(id);for(const [id,at] of seen)if(now-at>600000)seen.delete(id);};
 function refresh(){if(pending||clock()<retry)return;retry=clock()+30000;pending=(async()=>{const rows=await fetchPhones(),next=new Map();for(const r of rows){const phone=normalizePhone(r.phone,r.country);if(phone)next.set(r.id,hash(phone));}index=next;loadedAt=clock();failed=false;retry=clock()+300000;})().catch(()=>{failed=true;retry=clock()+30000;}).finally(()=>{pending=null;});}
 return {
  configured,
  async receive(req,res,url){
   if(!url.pathname.startsWith('/integrations/rinkel/incoming/'))return false;
   const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
   const reply=(status)=>{res.writeHead(status,headers);res.end();return true;};
   const supplied=url.pathname.slice('/integrations/rinkel/incoming/'.length);
   if(!configured||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(secret)))return reply(404);
   if(req.method!=='POST')return reply(405);
   if(req.headers.origin||req.headers['sec-fetch-site']||req.headers['content-type']?.split(';')[0]!=='application/json')return reply(403);
   try{
    let size=0,parts=[];for await(const part of req){size+=part.length;if(size>4096)return reply(413);parts.push(part);}const data=JSON.parse(Buffer.concat(parts).toString());
    if(!data||typeof data.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(data.id)||['__proto__','constructor','prototype'].includes(data.id)||typeof data.datetime!=='string')return reply(400);
    const at=Date.parse(data.datetime),to=normalizePhone(data.to),from=normalizePhone(data.from);prune();
    if(!Number.isFinite(at)||clock()-at>120000||at-clock()>30000||!allowed.has(to)||seen.has(data.id))return reply(200);
    if(events.length>=100||seen.size>=1000)return reply(429);
    seen.set(data.id,clock());events.push({id:data.id,seq:++counter,at,fromHash:from?hash(from):null,lastFour:from?from.slice(-4):null});return reply(200);
   }catch{return reply(400);}
  },
  history(rows){
   prune();for(const r of rows){if(!/^[-a-zA-Z0-9_]{1,100}$/.test(r.id)||['__proto__','constructor','prototype'].includes(r.id))continue;const phone=normalizePhone(r.phone);if(!phone)continue;while(historical.size>=250)historical.delete(historical.keys().next().value);historical.set(r.id,{id:r.id,at:r.at,fromHash:hash(phone),lastFour:phone.slice(-4),loadedAt:clock()});}
   return rows.filter(r=>historical.has(r.id)).map(({id,at})=>({id,at}));
  },
  dossier(state,booking){
   return {calls:Object.values(state.rinkelCalls||{}).filter(c=>c.booking===booking).map(({id,at,linkedAt})=>({id,at,linkedAt})),numbers:(state.rinkelNumbers?.[booking]||[]).map(({id,lastFour})=>({id,lastFour}))};
  },
  linkCall(state,input,bookings,actor){
   const fail=(status=400)=>{const e=Error('Controleer de oproep en dossierkeuze.');e.status=status;throw e;};
   if(!configured||input.confirm!==true||!bookings.some(b=>b.id===input.booking)||typeof input.call!=='string'||typeof input.remember!=='boolean')fail();
   prune();const call=events.find(e=>e.id===input.call)||historical.get(input.call);if(!call)fail(409);
   state.rinkelCalls||={};state.rinkelNumbers||={};
   const existing=state.rinkelCalls[call.id];if(existing&&existing.booking!==input.booking)fail(409);
   if(input.remember){
    if(!call.fromHash)fail();
    const customer=state.links[input.booking],sameCustomer=id=>id===input.booking||(customer&&state.links[id]===customer);
    for(const [id,numbers] of Object.entries(state.rinkelNumbers))if(!sameCustomer(id)&&numbers.some(n=>n.digest===call.fromHash))fail(409);
    const numbers=state.rinkelNumbers[input.booking]||=[];
    if(!numbers.some(n=>n.digest===call.fromHash)){if(numbers.length>=20)fail();numbers.push({id:randomUUID(),digest:call.fromHash,lastFour:call.lastFour});}
   }
   if(!existing&&Object.keys(state.rinkelCalls).length>=10000)fail();
   state.rinkelCalls[call.id]={id:call.id,at:call.at,booking:input.booking,linkedAt:new Date(clock()).toISOString()};
   state.history.push({at:new Date(clock()).toISOString(),actor,action:'rinkel-link',booking:input.booking});state.history=state.history.slice(-500);return state;
  },
  removeNumber(state,input,actor){
   const numbers=state.rinkelNumbers?.[input.booking];if(input.confirm!==true||!numbers?.some(n=>n.id===input.number)){const e=Error('Invalid number');e.status=400;throw e;}
   state.rinkelNumbers[input.booking]=numbers.filter(n=>n.id!==input.number);state.history.push({at:new Date(clock()).toISOString(),actor,action:'rinkel-number-remove',booking:input.booking});state.history=state.history.slice(-500);return state;
  },
  async poll({cursor,bookings,state}){
   if(!configured)return {enabled:false};prune();if(!index||clock()-loadedAt>=300000)refresh();
   const mark=instance+':'+counter,valid=typeof cursor==='string'&&cursor.startsWith(instance+':'),after=valid?Number(cursor.slice(instance.length+1)):0;
   if(!index||failed)return {enabled:true,ready:false,cursor:valid?cursor:undefined,failed};
   const effective=new Map(index);for(const [id,local] of Object.entries(state.dossiers||{}))if(Object.hasOwn(local.personal||{},'phone')){const phone=normalizePhone(local.personal.phone,local.personal.country||'');if(phone)effective.set(id,hash(phone));else effective.delete(id);}
   const extra=new Map();for(const [id,dossier] of Object.entries(state.dossiers||{}))extra.set(id,new Set((dossier.contacts?.phones||[]).map(p=>normalizePhone(p.value)).filter(Boolean).map(hash)));
   const fresh=events.filter(e=>e.seq>after).map(e=>({id:e.id,at:e.at,anonymous:!e.fromHash,lastFour:e.lastFour,matches:e.fromHash?bookings.filter(b=>effective.get(b.id)===e.fromHash||[...extra].some(([id,numbers])=>(id===b.id||(state.links[id]&&state.links[id]===state.links[b.id]))&&numbers.has(e.fromHash))||Object.entries(state.rinkelNumbers||{}).some(([id,numbers])=>(id===b.id||(state.links[id]&&state.links[id]===state.links[b.id]))&&numbers.some(n=>n.digest===e.fromHash))).map(b=>({id:b.id,index:b.index,name:b.name,departure:b.departure})):[]}));
   return {enabled:true,ready:true,cursor:mark,failed,recent:!valid,events:fresh};
  }
 };
}

export const rinkelIncoming=createRinkelIncoming();
