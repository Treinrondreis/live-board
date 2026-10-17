import {createHash,randomBytes} from 'node:crypto';
export const hash=value=>createHash('sha256').update(String(value)).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export const GOOGLE_SESSION='tr_google_session',GOOGLE_DEVICE='tr_google_device';
export const APP_SCOPES={stations:'Stationschef',treinhuis:'Treinhuis (KM-trein)',treinreiziger:'Treinreiziger',booklets:'Boekjesmaker',flora:'FloRA'};
export const INITIAL_ACCOUNTS=[
 {email:'hildebrand@treinreiziger.nl',role:'admin',apps:[]},
 {email:'reservations@treinrondreis.nl',role:'admin',apps:[]},
 {email:'tickets@treinrondreis.nl',role:'user',apps:['booklets','flora']},
 {email:'florentina.niculae@treinrondreis.nl',role:'user',apps:['booklets','flora']}
];
export function cookieValue(req,name){return String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';}
export function accessState(s){return s.googleAccess||= {accounts:Object.fromEntries(INITIAL_ACCOUNTS.map(a=>[a.email,{...a,active:true}])),devices:{},sessions:{},pending:{},audit:[]};}
export function audit(g,action,actor,detail,now){g.audit.push({at:now,action,actor,detail});g.audit=g.audit.slice(-500);}
export function accessCountryAllowed(s,country,now=Date.now()){return !!country&&!!s?.countries?.some(c=>c.code===country&&(!c.until||c.until>now));}
export function googleSessionFor(req,s,country,now=Date.now()){
 if(!accessCountryAllowed(s,country,now))return null;
 const g=s?.googleAccess,v=g?.sessions[hash(cookieValue(req,GOOGLE_SESSION))];
 if(!v||v.expires<=now)return null;
 const a=g.accounts[v.email],d=g.devices[v.device];
 if(!a?.active||a.sub!==v.sub||!d||d.status!=='approved'||d.sub!==v.sub||d.email!==v.email||v.device!==hash(cookieValue(req,GOOGLE_DEVICE)))return null;
 return {...v,role:a.role,apps:a.apps};
}
export function googleHasScope(session,scope){return !!session&&(session.role==='admin'||scope==='seinhuis'||session.apps.includes(scope));}
export function revokeDevice(g,id,actor,now){const d=g.devices[id];if(!d)return false;d.status='revoked';d.revokedAt=now;for(const [key,v] of Object.entries(g.sessions))if(v.device===id)delete g.sessions[key];audit(g,'device-revoked',actor,d.email,now);return true;}
export function blockAccount(g,email,actor,now){const a=g.accounts[email];if(!a)return false;a.active=false;for(const [key,v] of Object.entries(g.sessions))if(v.email===email)delete g.sessions[key];for(const [id,d] of Object.entries(g.devices))if(d.email===email)revokeDevice(g,id,actor,now);audit(g,'account-blocked',actor,email,now);return true;}
