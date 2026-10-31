import http from 'node:http';
import https from 'node:https';

// Only this fixed customer namespace bypasses Seinhuis login. The upstream
// checks a separate per-website session; never forward admin/browser headers.
export async function travelSiteGateway(req,res,url,{prefix,config,authenticate}){
 const match=url.pathname.match(new RegExp('^'+prefix+'/reis/([a-f0-9]{32})(?:/(data|login|logout|book|cover|chapter/\\d{1,3}|image/\\d{1,3}/\\d{1,2}))?/?$'));
 const fail=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error}));return true;};
 if(!match||url.search)return fail(404,'Niet gevonden.');
 const [,id,action]=match,method=['login','logout'].includes(action)?'POST':'GET';
 if(req.method!==method)return fail(405,'Ongeldige methode.');
 const length=Number(req.headers['content-length']||0);
 if(!Number.isSafeInteger(length)||length<0||length>512)return fail(413,'Verzoek te groot.');
 if(method==='POST'&&(req.headers.origin!==config.origin||req.headers['x-travel-site']!=='1'||!length))return fail(403,'Open de reiswebsite opnieuw.');
 if(method==='GET'&&length)return fail(400,'Ongeldig verzoek.');
 if(!config.upstream||!config.secret||config.secret.length<32)return fail(503,'De reiswebsite is tijdelijk niet beschikbaar.');
 let target;try{target=new URL(config.upstream);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error();}catch{return fail(503,'De reiswebsite is tijdelijk niet beschikbaar.');}
 target.pathname='/';target.search='';target.hash='';
 const headers={'x-booklets-gateway':config.secret};
 const cookieName='trr_reis_'+id;
 const value=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(value&&/^\d{10}\.[a-f0-9]{64}$/.test(value))headers['x-travel-site-session']=value;
 if(!['login','logout'].includes(action)&&await authenticate(req))headers['x-travel-site-owner']='1';
 if(method==='POST'){headers['content-length']=length;headers['content-type']='application/json';}
 const upstream=(target.protocol==='https:'?https:http).request(target,{method,path:'/internal/travel-sites/'+id+(action?'/'+action:''),headers},response=>{
  const forwarded={};for(const name of ['content-type','content-length','content-disposition','retry-after','content-security-policy'])if(response.headers[name])forwarded[name]=response.headers[name];
  if(['login','logout'].includes(action)&&response.headers['set-cookie'])forwarded['set-cookie']=response.headers['set-cookie'].filter(v=>v.startsWith(cookieName+'=')&&v.includes('Path='+prefix+'/reis/'+id+';')&&v.includes('HttpOnly')&&v.includes('Secure')&&v.includes('SameSite=Strict'));
  res.writeHead(response.statusCode,forwarded);response.on('error',()=>res.destroy());response.pipe(res);
 });
 upstream.setTimeout(60000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)fail(502,'De reiswebsite is tijdelijk niet bereikbaar.');else res.destroy();});
 req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
 if(method==='GET')upstream.end();else{let bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>512){upstream.destroy();if(!res.headersSent)fail(413,'Verzoek te groot.');}else upstream.write(b);});req.on('end',()=>upstream.end());req.on('error',()=>upstream.destroy());}
 return true;
}
