import {readMail,writeMail} from './flora-store.mjs';
import {floraRegister} from './flora-register.mjs';
import {createControlCycle} from './reisschema-control.mjs';
import {createPlanningSources} from './reisschema-feeds.mjs';
import {createDraftGoogle} from './reisschema-gmail.mjs';
import {createChangeMail} from './reisschema-mail.mjs';
export const draftGoogle=createDraftGoogle({read:readMail,write:writeMail});
export const reisschemaCycle=createControlCycle({register:floraRegister,read:readMail,write:writeMail,sources:createPlanningSources()});
export const changeMail=createChangeMail({register:floraRegister,read:readMail,write:writeMail,gmail:draftGoogle,origin:process.env.FLORA_PUBLIC_ORIGIN||'https://treinbord.up.railway.app'});
export function startReisschemaControls(){
 const run=()=>void reisschemaCycle.tick().catch(()=>{});
 // Wake on the minute; the durable cycle admits one scheduled round after 00:30 Amsterdam.
 const minute=()=>{run();setTimeout(minute,60000-Date.now()%60000).unref();};
 setTimeout(minute,1000).unref();
}
const session=req=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>/^(tr_google_session|tr_admin_session)=/.test(s))||'';
export function createControlRoutes({cycle=reisschemaCycle,mail=changeMail,google=draftGoogle}={}){
 return async(req,res,url)=>{
  const path=url.pathname.slice('/seinhuis/reisschemas'.length);
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};
  if(path==='/api/controls'&&req.method==='GET')return reply(200,{...await cycle.status(),gmail:await mail.status()});
  if(path==='/google/callback'&&req.method==='GET'){
   try{await google.callback(url.searchParams,session(req));res.writeHead(303,{Location:'/seinhuis/reisschemas'});res.end();return true;}catch{return reply(400,{error:'Google-koppeling niet bevestigd. Start opnieuw vanuit het beheer.'});}
  }
  if(!['/api/controls','/api/run-controls','/api/draft','/api/google-start'].includes(path))return false;
  if(req.method!=='POST')return reply(405,{error:'Gebruik de beheeractie.'});
  if(req.headers.origin!=='https://'+req.headers.host||req.headers['x-reisschemas']!=='1'||req.headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Open deze actie op de eigen beheerpagina.'});
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)return reply(413,{error:'Aanvraag te groot'});}
   const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();
   if(path==='/api/controls'){if(Object.keys(data).join()!=='enabled'||typeof data.enabled!=='boolean')throw Error();await cycle.enable(data.enabled);return reply(200,{ok:true});}
   if(path==='/api/run-controls'){if(Object.keys(data).join()==='legIds'){const result=await cycle.requestSelected(data.legIds);return reply(result.accepted?202:409,result);}if(Object.keys(data).length)throw Error();void cycle.tick({manual:true}).catch(()=>{});return reply(202,{ok:true});}
   if(path==='/api/google-start'){if(Object.keys(data).length)throw Error();return reply(200,{url:await google.start(session(req))});}
   const keys=['legId','changeKey','observationRevision','to','destination','advice'];
   if(Object.keys(data).length!==keys.length||keys.some(k=>typeof data[k]!=='string')||Object.keys(data).some(k=>!keys.includes(k)))throw Error();
   return reply(200,await mail.draft(data));
  }catch{return reply(400,{error:'Actie niet bevestigd. Controleer de actuele wijziging, Gmail-koppeling, afzenderalias en handtekening. Bij een eerdere conceptaanvraag eerst Gmail controleren.'});}
 };
}
export const controlRoutes=createControlRoutes();

// GET never writes a receipt. A deliberate same-origin form POST is required.
export function createReceiptHandler({mail=changeMail}={}){
 return async(req,res,url)=>{
  const match=url.pathname.match(/^\/reisschema-ontvangst\/([A-Za-z0-9_-]{43})$/);if(!match)return false;
  for(const [k,v] of Object.entries({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}))res.setHeader(k,v);
  let code=200,content;
  try{
   if(req.method==='POST'){
    if(req.headers.origin!=='https://'+req.headers.host||req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded')throw Error();
    let raw='';for await(const part of req){raw+=part;if(raw.length>100)throw Error();}if(raw!=='confirm=yes')throw Error();
    await mail.receipt(match[1],true);content='<h1>Bedankt</h1><p>Uw ontvangstbevestiging is geregistreerd.</p>';
   }else if(req.method==='GET'){
    const state=await mail.receipt(match[1]);content=state.confirmed?'<h1>Al bevestigd</h1><p>Uw ontvangstbevestiging is geregistreerd.</p>':'<h1>Ontvangst bevestigen</h1><p>Bevestig dat u de e-mail over uw gewijzigde reis heeft ontvangen.</p><form method="post"><button name="confirm" value="yes">Ontvangst bevestigen</button></form>';
   }else throw Error();
  }catch{code=400;content='<h1>Bevestigen niet mogelijk</h1><p>Deze link is verlopen, de wijziging is inmiddels aangepast of de verzending is nog niet geregistreerd. Neem contact op met Treinrondreis.</p>';}
  res.writeHead(code,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Treinrondreis · Ontvangst</title><main>'+content+'</main></html>');return true;
 };
}
export const handleReisschemaReceipt=createReceiptHandler();
