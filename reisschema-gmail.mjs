import {randomBytes,createHash} from 'node:crypto';
import {encryptGoogle,decryptGoogle} from './flora-google.mjs';
// Separate credentials; the existing reader and its readonly allowlist are unchanged.
export const DRAFT_SCOPES=['https://www.googleapis.com/auth/gmail.compose','https://www.googleapis.com/auth/gmail.settings.basic'];
const mailbox='reservations@treinrondreis.nl',alias='contact@treinrondreis.nl';
const hash=s=>createHash('sha256').update(s).digest('base64url');
const draftConfiguration=()=>({id:process.env.REISSCHEMA_DRAFT_GOOGLE_CLIENT_ID||'',secret:process.env.REISSCHEMA_DRAFT_GOOGLE_CLIENT_SECRET||'',origin:process.env.FLORA_PUBLIC_ORIGIN||'https://treinbord.up.railway.app'});
export function createDraftGoogle({read,write,configuration=draftConfiguration,fetcher=fetch,clock=Date.now}){
 const key='reisschema-draft-google',redirect='/seinhuis/reisschemas/google/callback';
 const config=()=>{const c=configuration();if(!c.id||!c.secret||new URL(c.origin).protocol!=='https:')throw Error('Google-configuratie ontbreekt');return c;};
 const request=async(url,options)=>{const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Google-aanvraag niet bevestigd');return r.json();};
 const token=(c,body)=>request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.id,client_secret:c.secret,...body}).toString()});
 const scopes=t=>{const granted=t.scope?.split(' ')||[];if(!t.access_token||granted.length!==DRAFT_SCOPES.length||!DRAFT_SCOPES.every(s=>granted.includes(s)))throw Error('Uitsluitend afzonderlijke concept- en aliasrechten vereist');};
 const access=async()=>{const c=config(),{value}=await read(key);if(!value.credentials)throw Error('Koppel Gmail voor concepten');const t=await token(c,{grant_type:'refresh_token',refresh_token:decryptGoogle(value.credentials,c.secret).refresh});scopes(t);return t.access_token;};
 return {
  async status(){const {value}=await read(key),c=configuration();return {configured:!!c.id&&!!c.secret,connected:!!value.credentials,mailbox,alias,sendsAutomatically:false};},
  async start(session){const c=config(),s=await read(key),state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
   await write(key,{...s.value,pending:{state:hash(state),session:hash(session),expires:clock()+600000,verifier:encryptGoogle(verifier,c.secret)}},s.revision);
   return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:c.id,redirect_uri:c.origin+redirect,response_type:'code',scope:DRAFT_SCOPES.join(' '),access_type:'offline',prompt:'consent',include_granted_scopes:'false',login_hint:mailbox,state,code_challenge:hash(verifier),code_challenge_method:'S256'});
  },
  async callback(params,session){const c=config(),s=await read(key),p=s.value.pending;
   if(!p||p.expires<clock()||p.state!==hash(params.get('state')||'')||p.session!==hash(session))throw Error('Koppelaanvraag verlopen');
   const {pending,...value}=s.value,revision=await write(key,value,s.revision);
   if(params.has('error')||!params.get('code'))throw Error('Toestemming ontbreekt');
   const t=await token(c,{grant_type:'authorization_code',code:params.get('code'),redirect_uri:c.origin+redirect,code_verifier:decryptGoogle(p.verifier,c.secret)});scopes(t);
   const account=await request('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+t.access_token}});
   if(account.emailAddress?.toLowerCase()!==mailbox||!t.refresh_token)throw Error('Verkeerde mailbox of geen blijvende toestemming');
   await write(key,{...value,credentials:encryptGoogle({refresh:t.refresh_token},c.secret)},revision);
  },
  async alias(){const a=await access();return request('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/'+encodeURIComponent(alias),{headers:{Authorization:'Bearer '+a}});},
  async createDraft({to,subject,html}){
   if([to,subject].some(s=>typeof s!=='string'||/[\r\n]/.test(s)))throw Error('Ongeldige berichtkop');
   const raw=Buffer.from('From: '+alias+'\r\nTo: '+to+'\r\nSubject: =?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(html).toString('base64').match(/.{1,76}/g).join('\r\n')).toString('base64url');
   const a=await access(),draft=await request('https://gmail.googleapis.com/gmail/v1/users/me/drafts',{method:'POST',headers:{Authorization:'Bearer '+a,'Content-Type':'application/json'},body:JSON.stringify({message:{raw}})});
   if(typeof draft.id!=='string'||! /^[a-zA-Z0-9_-]{1,200}$/.test(draft.id))throw Error('Concept niet bevestigd');return {id:draft.id};
  }
 };
}
