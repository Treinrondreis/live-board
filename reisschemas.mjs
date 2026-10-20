import {createReisschemaSummary,defaultLookupPlans,reisschemaSummary} from './reisschema-summary.mjs';
import {readFile} from 'node:fs/promises';
import {floraRegister} from './flora-register.mjs';
import {enrichChanges} from './reisschema-changes.mjs';
import {controlRoutes} from './reisschema-runtime.mjs';
import {assess,dayAt} from './reisschema-control.mjs';
import {applyNumberPolicy} from './reisschema-number-policy.mjs';
import {enrichPunctuality,punctualityHistory,punctualityStatus} from './punctuality.mjs';

const prefix='/seinhuis/reisschemas';
// Separate owner-only section; original itineraries stay immutable.
export function createReisschemasHandler({authenticate=async req=>(await import('./admin-security.mjs')).adminAuthenticated(req),register=floraRegister,lookupPlans=defaultLookupPlans,controls=controlRoutes}={}){
 return async(req,res,url)=>{
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  for(const [k,v] of Object.entries({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}))res.setHeader(k,v);
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};
  if(!await authenticate(req)){
   if(req.method==='GET'&&[prefix,prefix+'/'].includes(url.pathname)){res.writeHead(303,{Location:'/seinhuis'});res.end();return true;}
   return reply(401,{error:'Log eerst in als Seinhuis-beheerder.'});
  }
  const path=url.pathname.slice(prefix.length);
  if(await controls(req,res,url)){if(req.method!=='GET')reisschemaSummary.invalidate();return true;}
  const summary=register===floraRegister&&lookupPlans===defaultLookupPlans?reisschemaSummary:createReisschemaSummary({register,lookupPlans});
  if(path==='/api/punctuality'&&req.method==='GET'){
   const id=url.searchParams.get('legId');if(!/^[a-f0-9-]{36}$/.test(id||''))return reply(400,{error:'Ongeldige rit.'});
   const data=await register.summary();if(!data.available)return reply(503,{error:'Register niet bereikbaar.'});
   if(!data.legs.some(r=>r.leg_id===id))return reply(404,{error:'Rit niet gevonden.'});
   return reply(200,{measurements:await punctualityHistory(id)});
  }
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
    const row=[...state.legs,...state.notifications].find(r=>r.version_id===data.versionId&&r.leg_id===(data.legId||data.event?.leg_id));
    if(!row)return reply(409,{error:'Deze rit is niet meer actueel. Vernieuw de pagina.'});
    if(path==='/api/observation'){
     const result=applyNumberPolicy(row,{observation:data.event,sources:[JSON.stringify({source:data.event.source,downloaded_at:data.event.observed_at})]});
     if(!result.observation)return reply(400,{error:result.reason});
     await register.recordLegEvent(row.version_id,'observation',data.event);
     // Manual verification is explicit evidence too, separate from communication.
     await register.recordLegEvent(row.version_id,'control',{leg_id:row.leg_id,request_id:data.event.request_id+'-control',checked_at:data.event.observed_at,day:dayAt(Date.parse(data.event.observed_at)),outcome:'checked',reason:['Handmatige controle',result.reason].filter(Boolean).join('. '),sources:result.sources,assessment:assess(row,data.event),observation_request_id:data.event.request_id,manual_url:null});
    }
    else{
     if(typeof data.requestId!=='string'||! /^[a-zA-Z0-9-]{1,64}$/.test(data.requestId)||typeof data.communicatedAt!=='string'||!Number.isFinite(Date.parse(data.communicatedAt))||!['email','phone','post','other'].includes(data.method)||typeof data.reference!=='string'||data.reference.length>500)return reply(400,{error:'Ongeldige communicatiegegevens.'});
     if(!row.observation||row.observation.change_key!==data.changeKey)return reply(409,{error:'De wijziging is veranderd. Controleer de actuele melding opnieuw.'});
     const {change_key,...snapshot}=row.observation;
     delete snapshot.request_id;delete snapshot.leg_id;
     if(!row.notification_context)await register.recordLegEvent(row.version_id,'observation',{...snapshot,leg_id:row.leg_id,request_id:data.requestId+'-observation'});
     await register.recordLegEvent(row.version_id,'communication',{leg_id:row.leg_id,change_key,communicated_at:data.communicatedAt,method:data.method,reference:data.reference||'',request_id:data.requestId});
    }
    reisschemaSummary.invalidate();return reply(200,{ok:true});
   }catch{return reply(400,{error:'Opslaan niet bevestigd. Vernieuw de pagina en controleer de registratie.'});}
  }
  if(req.method!=='GET')return reply(405,{error:'Actie niet beschikbaar.'});
  if(path==='/api/register')return reply(200,await summary());
  const files={'':'reisschemas.html','/':'reisschemas.html','/reisschemas.js':'reisschemas.js','/reisschema-table.mjs':'reisschema-table.mjs','/reisschemas.css':'reisschemas.css','/reisschema-number-policy.mjs':'reisschema-number-policy.mjs','/punctuality-view.mjs':'punctuality-view.mjs'};
  if(!files[path])return reply(404,{error:'Niet gevonden.'});
  const file=files[path],ext=file.split('.').pop();
  res.writeHead(200,{'Content-Type':({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css'})[ext]+'; charset=utf-8'});
  res.end(await readFile(new URL('./'+file,import.meta.url)));return true;
 };
}
export const handleReisschemas=createReisschemasHandler();
