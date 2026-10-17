import {readFile} from 'node:fs/promises';
import {floraRegister} from './flora-register.mjs';
import {enrichChanges} from './reisschema-changes.mjs';

const prefix='/seinhuis/reisschemas';
// Separate owner-only section; original itineraries stay immutable.
export function createReisschemasHandler({authenticate=async req=>(await import('./admin-security.mjs')).adminAuthenticated(req),register=floraRegister,lookupPlans=async(number,date)=>(await import('./journeys.mjs')).journeyPlansForDate(number,date)}={}){
 return async(req,res,url)=>{
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  for(const [k,v] of Object.entries({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}))res.setHeader(k,v);
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};
  if(!await authenticate(req)){
   if(req.method==='GET'&&[prefix,prefix+'/'].includes(url.pathname)){res.writeHead(303,{Location:'/seinhuis'});res.end();return true;}
   return reply(401,{error:'Log eerst in als Seinhuis-beheerder.'});
  }
  const path=url.pathname.slice(prefix.length);
  async function summary(){const data=await register.summary();return {...data,legs:data.available?await enrichChanges(data.legs,lookupPlans):[]};}
  if(req.method==='POST'&&['/api/observation','/api/communication'].includes(path)){
   if(req.headers.origin!=='https://'+req.headers.host||req.headers['x-reisschemas']!=='1'||req.headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Open deze actie op de eigen beheerpagina.'});
   try{
    let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>8192)return reply(413,{error:'Aanvraag te groot.'});}
    const data=JSON.parse(raw);
    if(!data||typeof data!=='object'||Array.isArray(data))return reply(400,{error:'Ongeldige invoer.'});
    if(typeof data.versionId!=='string'||! /^[a-f0-9-]{36}$/.test(data.versionId))return reply(400,{error:'Ongeldige versie.'});
    const allowed=path==='/api/observation'?['versionId','event']:['versionId','legId','changeKey','communicatedAt','method','reference','requestId'];
    if(Object.keys(data).some(k=>!allowed.includes(k)))return reply(400,{error:'Ongeldige invoer.'});
    const state=await summary();if(!state.available)return reply(503,{error:'Register niet bereikbaar. Er is niets bevestigd.'});
    const row=state.legs.find(r=>r.version_id===data.versionId&&r.leg_id===(data.legId||data.event?.leg_id));
    if(!row)return reply(409,{error:'Deze rit is niet meer actueel. Vernieuw de pagina.'});
    if(path==='/api/observation')await register.recordLegEvent(row.version_id,'observation',data.event);
    else{
     if(typeof data.requestId!=='string'||! /^[a-zA-Z0-9-]{1,64}$/.test(data.requestId)||typeof data.communicatedAt!=='string'||!Number.isFinite(Date.parse(data.communicatedAt))||!['email','phone','post','other'].includes(data.method)||typeof data.reference!=='string'||data.reference.length>500)return reply(400,{error:'Ongeldige communicatiegegevens.'});
     if(!row.observation||row.observation.change_key!==data.changeKey)return reply(409,{error:'De wijziging is veranderd. Controleer de actuele melding opnieuw.'});
     const {change_key,...snapshot}=row.observation;
     delete snapshot.request_id;delete snapshot.leg_id;
     await register.recordLegEvent(row.version_id,'observation',{...snapshot,leg_id:row.leg_id,request_id:data.requestId+'-observation'});
     await register.recordLegEvent(row.version_id,'communication',{leg_id:row.leg_id,change_key,communicated_at:data.communicatedAt,method:data.method,reference:data.reference||'',request_id:data.requestId});
    }
    return reply(200,{ok:true});
   }catch{return reply(400,{error:'Opslaan niet bevestigd. Vernieuw de pagina en controleer de registratie.'});}
  }
  if(req.method!=='GET')return reply(405,{error:'Actie niet beschikbaar.'});
  if(path==='/api/register')return reply(200,await summary());
  const files={'':'reisschemas.html','/':'reisschemas.html','/reisschemas.js':'reisschemas.js','/reisschemas.css':'reisschemas.css'};
  if(!files[path])return reply(404,{error:'Niet gevonden.'});
  const file=files[path],ext=file.split('.').pop();
  res.writeHead(200,{'Content-Type':({html:'text/html',js:'text/javascript',css:'text/css'})[ext]+'; charset=utf-8'});
  res.end(await readFile(new URL('./'+file,import.meta.url)));return true;
 };
}
export const handleReisschemas=createReisschemasHandler();
