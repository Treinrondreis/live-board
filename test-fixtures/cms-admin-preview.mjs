import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initBoardCache,writeAdminSecurity,writeAppContent,readAppContent} from '../board-cache.mjs';
import {defaultContent,validateContent,handleAppCms} from '../app-cms.mjs';

// Only fictional content in an in-memory database. No startup jobs or production configuration.
export async function startCmsAdminPreview({port=0}={}){
  process.env.RAILWAY_ENVIRONMENT_ID='test';
  const db=new DatabaseSync(':memory:');await initBoardCache({backend:'sqlite',sqlite:db});
  const session=createHash('sha256').update('cms-fixture').digest('hex');
  await writeAdminSecurity({user:{name:'fixture-owner'},countries:[{code:'NL'}],sessions:{[session]:{expires:Date.now()+3600000,country:'NL'}}},0);
  const draft=validateContent(defaultContent());draft.pages[0].title='Voorbeeldnieuws';
  await writeAppContent({draft,published:structuredClone(draft),previous:structuredClone(draft),publishedAt:Date.now()},0);
  const assets=fileURLToPath(new URL('../public/admin-ui/',import.meta.url));
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://'+req.headers.host);
    requests.push({method:req.method,path:url.pathname});
    req.headers['x-real-ip']='145.100.100.100';
    // Model the existing HTTPS proxy contract while using a loopback-only test server.
    if(req.headers.origin==='http://'+req.headers.host)req.headers.origin='https://'+req.headers.host;
    if(['/seinhuis/treinreiziger','/seinhuis/paginas'].includes(url.pathname)){
      res.setHeader('Set-Cookie','tr_admin_session=cms-fixture; Path=/; HttpOnly; SameSite=Strict');
      req.headers.cookie='tr_admin_session=cms-fixture';
      const end=res.end.bind(res);
      res.end=(body,...args)=>end(typeof body==='string'?body.replace('<title>','<title>Voorbeeld · ').replace('Seinhuis / Treinreiziger</div>','Seinhuis / Treinreiziger / Proefomgeving met fictieve gegevens</div>'):body,...args);
    }
    if(url.pathname.startsWith('/admin-ui/')){
      const file=resolve(assets,decodeURIComponent(url.pathname.slice('/admin-ui/'.length))),rel=relative(assets,file);
      if(req.method!=='GET'||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)){res.writeHead(404);res.end();return;}
      try{const type=({css:'text/css',js:'text/javascript',svg:'image/svg+xml',woff2:'font/woff2'})[file.split('.').at(-1)];if(!type)throw Error();const bytes=await readFile(file);res.writeHead(200,{'Content-Type':type});res.end(bytes);}catch{res.writeHead(404);res.end();}return;
    }
    if(url.pathname==='/app/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html lang="nl"><title>Fictief conceptvoorbeeld</title><h1>Fictief conceptvoorbeeld</h1></html>');return;}
    try{if(await handleAppCms(req,res,url))return;}catch{res.writeHead(500);res.end('Testverzoek mislukt');return;}
    res.writeHead(404);res.end();
  });
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  return {origin:'http://127.0.0.1:'+server.address().port,requests,read:readAppContent,close:async()=>{await new Promise(r=>server.close(r));db.close();}};
}
