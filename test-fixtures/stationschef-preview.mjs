import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initBoardCache,writeAdminSecurity} from '../board-cache.mjs';
import {stationschefPage,stationschefOverview} from '../stationschef-layout.mjs';
import {defaultAppearance,standardLayouts} from '../board-admin.mjs';
import {defaultConnectionRules,stationAliases} from '../connections-rules.mjs';

// Loopback-only fictional data; no production configuration, collectors or database.
export async function startStationschefPreview({port=0}={}){
 process.env.RAILWAY_ENVIRONMENT_ID='test';
 const db=new DatabaseSync(':memory:');await initBoardCache({backend:'sqlite',sqlite:db});
 const session=createHash('sha256').update('stationschef-fixture').digest('hex');
 await writeAdminSecurity({user:{name:'fixture-owner'},countries:[{code:'NL'}],sessions:{[session]:{expires:Date.now()+3600000,country:'NL'}}},0);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const requests=[],boards=[{id:'voorbeeld',name:'Voorbeeldstad',country:'NL',revision:0,settings:{title:'Voorbeeldstad',footer:'',enabled:true,directions:[],appearance:{...defaultAppearance}}}];
 let platform={stationKey:'voorbeeld',name:'Voorbeeldstad',revision:0,groups:[{tracks:['1','2'],kind:'opposite',minutes:'',route:'Geen bijzonderheden',pockets:[],notes:''}],trackNotes:[],map:'',photo:'',caption:'',source:'',notes:''};
 let rules={rules:structuredClone(defaultConnectionRules.slice(0,1)),stations:stationAliases,revision:0};
 let screens=[{id:'0',revision:0,url:'/',settings:{name:'Voorbeeldscherm',italy:true,connections:true,pinCancelled:true,maxPinned:4,minDelay:20,rows:8,seconds:10,stationRules:[],trains:[{number:'999',source:'DB',stations:[]}],connectionIds:null}}];
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://'+req.headers.host),p=url.pathname;requests.push({method:req.method,path:p});
   req.headers['x-real-ip']='145.100.100.100';req.headers.cookie='tr_admin_session=stationschef-fixture';
   const json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
   let data;if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;data=JSON.parse(body);}
   if(p==='/stationschef/api/aansluitingen'){if(data)rules={...rules,...data,revision:rules.revision+1};json(rules);return;}
   if(p==='/stationschef/api/perrons'){if(data)platform={...data,revision:platform.revision+1};json(data?platform:[platform]);return;}
   if(p==='/stationschef/api/treinbord'){if(data){const result={id:data.action==='copy'?'1':data.id,url:data.action==='copy'?'/1':'/',revision:1,settings:data.settings};if(data.action==='copy')screens.push(result);else screens[0]=result;json(result);}else json({screens,sources:{DB:'Voorbeeldbron'},stations:['Voorbeeldstad'],stationsBySource:{DB:['Voorbeeldstad']},connections:rules.rules});return;}
   if(p.startsWith('/api/board-admin/')){
    const action=p.split('/').at(-1);
    if(action==='boards')json({boards});else if(action==='layouts')json({layouts:standardLayouts});else if(action==='session')json({authenticated:true});else if(action==='preview')json({source:'Voorbeeldbron',directions:[],departures:[]});else if(action==='save'){Object.assign(boards[0],{settings:data.settings,revision:boards[0].revision+1,updatedAt:Date.now()});json(boards[0]);}else json({});return;
   }
   if(p.startsWith('/embed/')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Fictief bord</title><h2>Voorbeeldstad</h2><p>Voorbeeld van een vertrekbord</p>');return;}
   const pages={'/stationschef/treinbord':['screen-settings.html','treinbord'],'/stationschef/borden':['public/board-admin.html','borden'],'/stationschef/aansluitingen':['connections-admin.html','aansluitingen'],'/stationschef/perrons':['platform-admin.html','perrons']};
   if(p==='/stationschef'||pages[p]){res.setHeader('Content-Type','text/html');const html=p==='/stationschef'?await stationschefOverview(req):await stationschefPage(req,await readFile(resolve(root,pages[p][0]),'utf8'),pages[p][1]);res.end(html.replace('<title>','<title>Voorbeeld · '));return;}
   const scripts={'/stationschef/treinbord.js':'screen-settings.js','/stationschef/aansluitingen.js':'connections-admin.js','/stationschef/platform-rules.mjs':'platform-rules.mjs','/board-admin.js':'board-admin.js','/admin-security.css':'admin-security.css'};
   const file=resolve(root,scripts[p]||(p.startsWith('/admin-ui/')?'public'+p:'')),rel=relative(root,file);
   if(!scripts[p]&&!p.startsWith('/admin-ui/')||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)){res.writeHead(404);res.end();return;}
   const type=({js:'text/javascript',mjs:'text/javascript',css:'text/css',svg:'image/svg+xml'})[file.split('.').at(-1)];if(!type){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',type);res.end(await readFile(file));
  }catch{res.writeHead(500);res.end('Fictieve testserverfout');}
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 return {origin:'http://127.0.0.1:'+server.address().port,requests,state:()=>({boards,platform,rules,screens}),close:async()=>{await new Promise(r=>server.close(r));db.close();}};
}
