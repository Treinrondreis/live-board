import {createHash,createPublicKey,verify} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('base64url');
export function googleLoginConfig(){return {id:process.env.SEINHUIS_GOOGLE_CLIENT_ID||'',secret:process.env.SEINHUIS_GOOGLE_CLIENT_SECRET||'',origin:process.env.SEINHUIS_PUBLIC_ORIGIN||'https://treinbord.up.railway.app'};}
export function validateGoogleClaims(p,c,nonce,now=Date.now()){
 if(!['https://accounts.google.com','accounts.google.com'].includes(p.iss)||p.aud!==c.id||(p.azp&&p.azp!==c.id)||!Number.isFinite(p.exp)||p.exp*1000<=now||!Number.isFinite(p.iat)||p.iat*1000>now+60000||p.iat*1000<now-10*60000||p.nonce!==nonce||typeof p.sub!=='string'||!/^\d{1,255}$/.test(p.sub)||p.email_verified!==true||typeof p.email!=='string')throw Error('Google-identiteit kon niet worden bevestigd. Log opnieuw in.');
 const email=p.email.toLowerCase(),domain=email.split('@')[1];
 // For these Workspace accounts Google must be authoritative for the domain.
 if(!domain||p.hd!==domain)throw Error('Gebruik het Google Workspace-account met dit e-mailadres.');
 return {sub:p.sub,email};
}
export function createGoogleLogin({configuration=googleLoginConfig,fetcher=fetch,now=()=>Date.now()}={}){
 let keys=[],until=0;
 async function request(url,options){const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Google-login is tijdelijk niet beschikbaar. Probeer opnieuw.');return r.json();}
 return {
  configured(){const c=configuration();try{return !!c.id&&!!c.secret&&new URL(c.origin).protocol==='https:'&&new URL(c.origin).origin===c.origin;}catch{return false;}},
  start(p){const c=configuration(),u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:c.id,redirect_uri:c.origin+'/seinhuis/google/callback',response_type:'code',scope:'openid email',state:p.state,nonce:p.nonce,code_challenge:digest(p.verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();return u.href;},
  async finish(code,p){const c=configuration(),t=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.id,client_secret:c.secret,redirect_uri:c.origin+'/seinhuis/google/callback',grant_type:'authorization_code',code,code_verifier:p.verifier}).toString()});
   if(typeof t.id_token!=='string'||t.id_token.length>16000)throw Error('Google heeft geen geldige identiteit teruggegeven.');
   const parts=t.id_token.split('.');if(parts.length!==3)throw Error('Ongeldig Google-antwoord.');
   const header=JSON.parse(Buffer.from(parts[0],'base64url')),payload=JSON.parse(Buffer.from(parts[1],'base64url'));
   if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('Ongeldig Google-antwoord.');
   if(until<=now()||!keys.some(k=>k.kid===header.kid)){const result=await request('https://www.googleapis.com/oauth2/v3/certs');keys=result.keys||[];until=now()+3600000;}
   const key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');
   if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('Google-identiteit kon niet worden bevestigd.');
   return validateGoogleClaims(payload,c,p.nonce,now());
  }
 };
}
