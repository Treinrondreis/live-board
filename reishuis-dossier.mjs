import {normalizePhone} from './reishuis-rinkel.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {sanityConfig} from './flora-sanity.mjs';

export const personalFields=['firstName','lastName','address','postalCode','city','country','email','phone','emergencyName','emergencyPhone'];
const todoFields=['title','description','status','quantity','startDate','endDate','bookableFrom','deadline','tag','supplierBookingNumber'];
const lineFields=['title','subTitle','quantity','price','costs','type','visible','date','vatRate'];
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const str=v=>typeof v==='string'?v:'';
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()&&Number.isFinite(Number(v))?Number(v):null;
const pick=(o,fields)=>Object.fromEntries(fields.map(k=>[k,str(o?.[k])]));
const rows=(list,fields,type)=>(Array.isArray(list)?list:[]).map((v,i,all)=>{
 const uniqueKey=typeof v._key==='string'&&all.filter(r=>r._key===v._key).length===1;
 const identity=uniqueKey?v._key:JSON.stringify(v),occurrence=uniqueKey?0:all.slice(0,i).filter(r=>JSON.stringify(r)===identity).length;
 const row={id:'source-'+digest([type,identity,occurrence]).slice(0,32),...pick(v,fields)};
 for(const k of ['quantity','price','costs','vatRate'])if(fields.includes(k))row[k]=number(k==='quantity'?v.quantity??v.amount??1:v[k]);
 if(type==='todo'){row.status=v.done===true?'done':['pending','planned','doing','done','caution'].includes(v.status)?v.status:v.status?'unknown':'pending';row.sourceStatus=row.status;}
 if(type==='line'){row.visible=v.visible!==false;row.type=['product','discount','margin','option'].includes(v.type)?v.type:'product';}
 return row;
});
export function normalizeDossier(b){
 if(!b||typeof b._id!=='string')throw Error('Invalid dossier');
 return {formatVersion:2,personal:pick(b,personalFields),comment:str(b.comment),notes:str(b.notes),initialPrice:number(b.initialPrice),invoiceTitle:str(b.title),invoiceSubtitle:str(b.subtitle),vendorName:str(b.vendorName),
 passengers:(Array.isArray(b.passengers)?b.passengers:[]).map(p=>pick(p,['firstName','lastName','name','dateOfBirth','type','gender','nationality','countryOfResidence','station'])),
 payments:(Array.isArray(b.payments)?b.payments:[]).map(p=>({status:str(p.status),type:str(p.type),price:number(p.price),dateCreated:str(p.dateCreated),dateDue:str(p.dateDue),fulfillments:(Array.isArray(p.fulfillments)?p.fulfillments:[]).map(f=>({amount:number(f.amount),date:str(f.date),type:str(f.type)}))})),
 todos:rows(b.todos,todoFields,'todo'),lines:rows(b.lines,lineFields,'line')};
}
export const dossierQuery='*[_type == "tourBooking" && _id in [$id,$draft]]{_id,firstName,lastName,address,postalCode,city,country,email,phone,emergencyName,emergencyPhone,comment,notes,initialPrice,title,subtitle,vendorName,passengers[]{firstName,lastName,name,dateOfBirth,type,gender,nationality,countryOfResidence,station},todos[]{_key,title,description,status,done,quantity,startDate,endDate,bookableFrom,deadline,tag,supplierBookingNumber},lines[]{_key,title,subTitle,quantity,amount,price,costs,type,visible,date,vatRate},payments[]{status,type,price,dateCreated,dateDue,fulfillments[]{amount,date,type}}}';
export async function fetchReishuisDossier(id,{fetcher=fetch,config=sanityConfig()}={}){
 if(!/^[-a-zA-Z0-9_.]{1,160}$/.test(id)||id.startsWith('drafts.')||['__proto__','constructor','prototype'].includes(id))throw Error('Invalid booking');
 if(!config.token||config.project!=='il9cyh3m'||config.dataset!=='production')throw Error('Dossier requires existing read-only connection');
 const u=new URL('https://il9cyh3m.api.sanity.io/v2026-10-03/data/query/production');
 u.searchParams.set('query',dossierQuery);u.searchParams.set('$id',JSON.stringify(id));u.searchParams.set('$draft',JSON.stringify('drafts.'+id));u.searchParams.set('perspective','raw');
 const r=await fetcher(u,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Dossier read failed');const {result}=await r.json();
 if(!Array.isArray(result)||!result.length||result.some(b=>![id,'drafts.'+id].includes(b._id)))throw Error('Dossier unavailable');
 return normalizeDossier(result.find(b=>b._id==='drafts.'+id)||result[0]);
}
export function mergeDossier(source,local={}){
 const merge=(rows,overrides={})=>[...rows.map(r=>({...r,...(overrides[r.id]?._edited?Object.fromEntries(overrides[r.id]._edited.map(k=>[k,overrides[r.id][k]])):overrides[r.id]),localChanged:!!overrides[r.id],localStatus:!!overrides[r.id]&&(!overrides[r.id]._edited||overrides[r.id]._edited.includes('status'))})),...Object.entries(overrides).filter(([id])=>!rows.some(r=>r.id===id)).map(([id,r])=>({...r,id,localChanged:true,sourceRemoved:!r.local}))];
 return {...source,contacts:local.contacts||{phones:[],emails:[]},personal:{...source.personal,...local.personal},comment:local.notes?.comment??source.comment,notes:local.notes?.notes??source.notes,
 todos:merge(source.todos,local.todos),lines:merge(source.lines,local.lines),localChanged:Object.keys(local).length>0};
}
function bad(){const e=Error('Invalid dossier input');e.status=400;throw e;}
function clean(values,fields){
 if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length||Object.keys(values).some(k=>!fields.includes(k)))bad();
 return Object.fromEntries(Object.entries(values).map(([k,v])=>{
  if(['quantity','price','costs','vatRate'].includes(k)){
   if(v===null&&['costs','vatRate'].includes(k))return [k,null];
   if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>10000000||k==='quantity'&&(v<0||v>10000)||k==='vatRate'&&(v<0||v>100))bad();return [k,v];
  }
  if(k==='visible'){if(typeof v!=='boolean')bad();return [k,v];}
  if(typeof v!=='string'||v.includes('\u0000')||v.length>(['notes','comment','description'].includes(k)?10000:500))bad();
  if(['startDate','endDate','bookableFrom','deadline','date'].includes(k)&&v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))bad();
  if(k==='status'&&!['pending','planned','doing','done','caution','unknown'].includes(v)||k==='type'&&!['product','discount','margin','option'].includes(v))bad();
  return [k,v.trim()];
 }));
}
export function changeDossier(state,input,source){
 const id=input.booking;if(typeof id!=='string'||!/^[-a-zA-Z0-9_.]{1,160}$/.test(id)||['__proto__','constructor','prototype'].includes(id))bad();
 const section=input.section,local=structuredClone(state.dossiers?.[id]||{});
 if(section==='contacts'){
  const v=input.values;if(!v||Object.keys(v).some(k=>!['phones','emails'].includes(k)))bad();
  const country=mergeDossier(source,local).personal.country;
  local.contacts=Object.fromEntries(['phones','emails'].map(kind=>{
   if(!Array.isArray(v[kind])||v[kind].length>10)bad();const seen=new Set();
   return [kind,v[kind].map(r=>{if(!r||Object.keys(r).some(k=>!['value','label'].includes(k))||typeof r.value!=='string'||r.value.includes('\0')||typeof r.label!=='string'||r.label.length>80||r.label.includes('\0'))bad();const value=kind==='phones'?normalizePhone(r.value,country):r.value.trim();if(!value||kind==='emails'&&(value.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)))bad();const key=value.toLowerCase();if(seen.has(key))bad();seen.add(key);return {value,label:r.label.trim()};})];
  }));
 }else if(section==='todo'&&input.resetStatus===true){
  if(!source.todos.some(r=>r.id===input.item))bad();const row=local.todos?.[input.item];if(row){delete row.status;row._edited=(row._edited||Object.keys(row).filter(k=>todoFields.includes(k))).filter(k=>k!=='status');}
 }else if(section==='personal'||section==='notes')local[section]={...local[section],...clean(input.values,section==='personal'?personalFields:['notes','comment'])};
 else if(section==='todo'||section==='line'){
  const collection=section==='todo'?'todos':'lines',fields=section==='todo'?todoFields:lineFields;
  const values=clean(input.values,fields);let item=input.item;
  const current=mergeDossier(source,local)[collection].find(r=>r.id===item);
  if(input.add===true){if(item)bad();item='local-'+randomUUID();const defaults=section==='todo'?{status:'pending',quantity:1}:{quantity:1,price:0,costs:null,type:'product',visible:true};local[collection]={...local[collection],[item]:{...defaults,...values,local:true}};}
  else {if(!current)bad();local[collection]={...local[collection],[item]:{...current,...values,_edited:[...new Set([...(local[collection]?.[item]?._edited||Object.keys(local[collection]?.[item]||{}).filter(k=>fields.includes(k))),...Object.keys(values).filter(k=>values[k]!==current[k])])]}};delete local[collection][item].localChanged;delete local[collection][item].sourceRemoved;}
 }else bad();
 state.dossiers??={};state.dossiers[id]=local;return state;
}
export function createDossierCache({readSnapshot,writeSnapshot,fetchDossier,clock=Date.now}){
 const pending=new Map(),retry=new Map();
 async function refresh(id){
  if(pending.has(id))return pending.get(id);
  const startedAt=clock(),task=(async()=>{const data=await fetchDossier(id);const value={data,syncedAt:startedAt,version:digest(data)};await writeSnapshot(id,value);retry.delete(id);return value;})().catch(()=>{retry.set(id,clock()+30000);throw Error('Dossier refresh unavailable');}).finally(()=>pending.delete(id));pending.set(id,task);return task;
 }
 return {async get(id){let saved=await readSnapshot(id);if(!saved||saved.data?.formatVersion!==2){if((retry.get(id)||0)>clock())throw Error('Dossier unavailable');saved=await refresh(id);}else if(clock()-saved.syncedAt>=60000&&(retry.get(id)||0)<=clock())void refresh(id).catch(()=>{});return {...saved,refreshing:pending.has(id),stale:clock()-saved.syncedAt>=60000,syncFailed:(retry.get(id)||0)>clock()};}};
}
