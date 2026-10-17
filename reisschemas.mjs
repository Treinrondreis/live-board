import {readFile} from 'node:fs/promises';
import {floraRegister} from './flora-register.mjs';

const prefix='/seinhuis/reisschemas';
// Separate owner-only section; no new account grants or data writes.
export function createReisschemasHandler({authenticate=async req=>(await import('./admin-security.mjs')).adminAuthenticated(req),register=floraRegister}={}){
 return async(req,res,url)=>{
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  for(const [k,v] of Object.entries({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}))res.setHeader(k,v);
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};
  if(!await authenticate(req)){
   if(req.method==='GET'&&[prefix,prefix+'/'].includes(url.pathname)){res.writeHead(303,{Location:'/seinhuis'});res.end();return true;}
   return reply(401,{error:'Log eerst in als Seinhuis-beheerder.'});
  }
  if(req.method!=='GET')return reply(405,{error:'Dit onderdeel is alleen-lezen.'});
  const path=url.pathname.slice(prefix.length);
  if(path==='/api/register')return reply(200,await register.summary());
  const files={'':'reisschemas.html','/':'reisschemas.html','/reisschemas.js':'reisschemas.js','/reisschemas.css':'reisschemas.css'};
  if(!files[path])return reply(404,{error:'Niet gevonden.'});
  const file=files[path],ext=file.split('.').pop();
  res.writeHead(200,{'Content-Type':({html:'text/html',js:'text/javascript',css:'text/css'})[ext]+'; charset=utf-8'});
  res.end(await readFile(new URL('./'+file,import.meta.url)));return true;
 };
}
export const handleReisschemas=createReisschemasHandler();
