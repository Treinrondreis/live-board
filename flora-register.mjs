import {createRegisterClient} from './reisschema-register-client.mjs';

// This client can only read itineraries and append checks; never write Sanity.
export function createFloraRegister({env=process.env,fetcher=fetch,clock=Date.now}={}) {
  let client, cached, expires=0;
  function configuredClient() {
    if(!client)client=createRegisterClient({baseUrl:env.REISSCHEMA_REGISTER_URL,
      token:env.REGISTER_FLORA_TOKEN,fetcher});
    return client;
  }
  async function summary() {
    if(!env.REISSCHEMA_REGISTER_URL&&!env.REGISTER_FLORA_TOKEN)
      return {configured:false,available:false,legs:[]};
    try {
      if(!cached||clock()>=expires){cached=await configuredClient().findLegs();expires=clock()+30000;}
      return {configured:true,available:true,legs:cached};
    } catch {
      // Never display stale cached itineraries as the current central register.
      cached=null;expires=0;
      return {configured:true,available:false,legs:[],error:'Reisschemaregister niet bereikbaar. Er worden geen oude registergegevens getoond.'};
    }
  }
  async function recordCheck(input) {
    if(!input||typeof input!=='object'||Array.isArray(input)||
       Object.keys(input).some(k=>!['versionId','outcome','sources','requestId','legIds','notes'].includes(k)))
      throw Error('Ongeldige controleaanvraag.');
    const {versionId,...evidence}=input;
    await configuredClient().recordCheck(versionId,evidence);
    cached=null;expires=0;
    return {ok:true};
  }
  return Object.freeze({summary,recordCheck});
}
export const floraRegister=createFloraRegister();

