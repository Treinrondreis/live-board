import {test} from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createGoogleLogin,validateGoogleClaims} from './google-login.mjs';
test('Google tokens require a valid signature, nonce, client and authoritative Workspace identity',async()=>{
 const now=Date.now(),c={id:'client-id',secret:'client-secret',origin:'https://example.test'},p={iss:'https://accounts.google.com',aud:c.id,sub:'123456',email:'tickets@treinrondreis.nl',email_verified:true,hd:'treinrondreis.nl',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600,nonce:'nonce'};
 assert.deepEqual(validateGoogleClaims(p,c,'nonce',now),{email:p.email,sub:p.sub});
 for(const changes of [{iss:'evil'},{aud:'wrong'},{azp:'wrong'},{email_verified:false},{hd:'evil.test'},{nonce:'wrong'},{exp:0},{iat:Math.floor(now/1000)-1000},{sub:'invalid'}])assert.throws(()=>validateGoogleClaims({...p,...changes},c,'nonce',now));
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'key',use:'sig',alg:'RS256'};
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');let body=encode({alg:'RS256',kid:'key'})+'.'+encode(p),signed=body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
 const seen=[];const login=createGoogleLogin({configuration:()=>c,now:()=>now,fetcher:async(url,opts)=>{seen.push({url,opts});return {ok:true,json:async()=>url.endsWith('/token')?{id_token:signed}:{keys:[jwk]}};}});
 assert.equal(login.configured(),true);const start=new URL(login.start({state:'state',nonce:'nonce',verifier:'verifier'}));assert.equal(start.searchParams.get('scope'),'openid email');assert.equal(start.searchParams.get('code_challenge_method'),'S256');assert.equal(start.searchParams.get('redirect_uri'),c.origin+'/seinhuis/google/callback');
 assert.equal((await login.finish('code',{nonce:'nonce',verifier:'verifier'})).email,p.email);assert.ok(seen[0].opts.body.includes('code_verifier=verifier'));
 signed=body+'.'+Buffer.alloc(256).toString('base64url');await assert.rejects(()=>login.finish('code',{nonce:'nonce',verifier:'verifier'}));
 assert.equal(createGoogleLogin({configuration:()=>({...c,origin:'http://example.test'})}).configured(),false);
});
