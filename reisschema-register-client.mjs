// Server-only adapter. Never bundle with browser JavaScript or expose credentials.
export function createRegisterClient({baseUrl, token, fetcher=fetch}={}) {
  let base;
  try { base=new URL(baseUrl); } catch { throw Error('Register configuration missing.'); }
  if (!['http:','https:'].includes(base.protocol) || !base.hostname.endsWith('.railway.internal') ||
      base.username || base.password || base.pathname!=='/' || base.search || base.hash ||
      typeof token!=='string' || token.length<32 || token.length>500) {
    throw Error('Use a private register address and a separate Flora service credential.');
  }
  async function request(path, {query, body}={}) {
    const url=new URL(path,base);
    if(query)for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
    const options={method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}};
    if(body){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);
      if(Buffer.byteLength(options.body)>256*1024)throw Error('Register request too large.');}
    try {
      const response=await fetcher(url,options);
      if(!response.ok)throw Error('Request failed.');
      // Keep response size bounded; do not echo remote errors, bodies, URLs or tokens.
      const reader=response.body?.getReader();
      if(!reader)throw Error('Empty response.');
      const parts=[];let size=0;
      try { while(true){const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;if(size>4*1024*1024)throw Error('Response too large.');parts.push(value);} }
      finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch { throw Error('Reisschemaregister niet bereikbaar of aanvraag afgewezen. Er zijn geen lokale vervangingsgegevens gebruikt.'); }
  }
  async function findLegs({dossier,train,travelDate,history=false}={}) {
    const query={history,limit:200};
    for(const [key,value] of Object.entries({dossier,train,travel_date:travelDate})) {
      if(value!==undefined){if(typeof value!=='string'||!value.trim()||value.length>100)throw Error('Invalid filter.');query[key]=value;}
    }
    if(typeof history!=='boolean')throw Error('Invalid history flag.');
    const all=[];
    for(let offset=0;offset<50000;offset+=200){
      const data=await request('/v1/legs',{query:{...query,offset}});
      if(!Array.isArray(data.legs)||data.legs.length>200||data.offset!==offset)throw Error('Ongeldig antwoord van reisschemaregister.');
      all.push(...data.legs);
      if(data.legs.length<200)return all;
    }
    throw Error('Registerselectie te groot; beperk de selectie. Geen gedeeltelijk resultaat gebruiken.');
  }
  async function recordCheck(versionId,{outcome,sources,requestId,legIds,notes=''}={}) {
    if(!/^[a-f0-9-]{36}$/.test(versionId)||!['unchanged','correction_needed','incomplete'].includes(outcome)||
       !Array.isArray(sources)||!sources.length||typeof requestId!=='string'||!requestId)throw Error('Controlebewijs ontbreekt.');
    const body={outcome,sources,request_id:requestId,notes};
    if(legIds!==undefined)body.leg_ids=legIds;
    return request('/v1/versions/'+versionId+'/checks',{body});
  }
  async function recordLegEvent(versionId,kind,event){
    if(!/^[a-f0-9-]{36}$/.test(versionId)||!['observation','communication','control','draft','receipt'].includes(kind)||!event||typeof event!=='object')throw Error('Ongeldige ritmelding.');
    return request('/v1/versions/'+versionId+'/leg-events',{body:{kind,event}});
  }
  async function notificationContexts(){const data=await request('/v1/notification-contexts');if(!Array.isArray(data.notifications))throw Error('Ongeldig registerantwoord.');return data.notifications;}
  return Object.freeze({findLegs,recordCheck,recordLegEvent,notificationContexts});
}
