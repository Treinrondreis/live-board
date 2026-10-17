import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,sep} from 'node:path';

const root=fileURLToPath(new URL('../public/admin-ui/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
export function createAdminUiPreview(){
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=resolve(root,pathname==='/'?'specimen.html':pathname.slice(1));
      const rel=relative(root,file),ext=file.slice(file.lastIndexOf('.'));
      if(rel.startsWith('..'+sep)||rel==='..'||isAbsolute(rel)||!types[ext]){res.writeHead(404);res.end();return;}
      const content=await readFile(file);
      res.writeHead(200,{'Content-Type':types[ext]});res.end(content);
    }catch{res.writeHead(404);res.end();}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createAdminUiPreview();
  server.listen(Number(process.env.PORT||8794),'127.0.0.1',()=>console.log('Stijlbasis: http://127.0.0.1:'+server.address().port));
}
