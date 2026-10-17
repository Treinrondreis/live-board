// Read-only Rinkel access. Audio and provider credentials never enter Postgres.
export function createRinkelMedia({key=process.env.RINKEL_READ_API_KEY||'',allowedNumbers=process.env.RINKEL_ALLOWED_NUMBERS||'',fetcher=fetch}={}){
 const allowed=new Set(allowedNumbers.split(',').map(v=>v.trim()));
 const configured=!!key&&allowed.size>0;
 const valid=id=>typeof id==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(id);
 async function json(path){
  const options=headers=>({method:'GET',redirect:'error',headers,signal:AbortSignal.timeout(15000)});
  let r=await fetcher('https://api.rinkel.com/v1'+path,options({Authorization:'Bearer '+key,Accept:'application/json'}));
  // Rinkel documents the legacy header as supported. One read-only fallback
  // handles accounts whose endpoint has not adopted Bearer API-key auth yet.
  if([401,403,500].includes(r.status)){await r.body?.cancel();r=await fetcher('https://api.rinkel.com/v1'+path,options({'x-rinkel-api-key':key,Accept:'application/json'}));}
  if(!r.ok){const e=Error('Rinkel API request failed');e.rinkelStatus=r.status;throw e;}
  const body=await r.text();if(body.length>1024*1024)throw Error('Ongeldig antwoord.');return JSON.parse(body).data;
 }
 async function details(call){
  if(!configured||!valid(call?.id))throw Error('Rinkel-opnames zijn nog niet aangesloten.');
  const data=await json('/call-detail-records/by-call-id/'+encodeURIComponent(call.id)+'?includeDetails=true');
  if(data?.callId!==call.id||!allowed.has(data.internalNumber?.number))throw Error('Dit gesprek valt buiten de gekoppelde lijnen.');
  return data;
 }
 return {configured,
  async history(number,page=1){
   if(!configured||!/^\+[1-9]\d{7,14}$/.test(number)||!Number.isInteger(page)||page<1||page>100)throw Error('Gebruik een internationaal telefoonnummer.');
   const params=new URLSearchParams({externalNumber:number,page:String(page),perPage:'25',contactLookup:'false',includeDetails:'false',sort:'date',sortOrder:'DESC'}),rows=await json('/call-detail-records?'+params);
   if(!Array.isArray(rows)||rows.length>25)throw Object.assign(Error('Ongeldige gesprekshistorie.'),{rinkelShape:true});
   return {rows:rows.filter(r=>valid(r.callId)&&allowed.has(r.internalNumber?.number)&&r.externalNumber?.e164===number).map(r=>({id:r.callId,at:Date.parse(r.date),phone:number})).filter(r=>Number.isFinite(r.at)),hasMore:rows.length===25&&page<100};
  },
  async info(call){
   const data=await details(call),summary=data.insights?.customSummary||data.insights?.summary;
   return {recording:valid(data.callRecording?.id),summary:typeof summary==='string'?summary.slice(0,12000):null};
  },
  async audio(call){
   const data=await details(call),id=data.callRecording?.id;if(!valid(id))throw Error('Geen opname beschikbaar.');
   const stream=await json('/call-recordings/'+encodeURIComponent(id)+'/stream');let url;
   try{url=new URL(stream.url);}catch{throw Error('Ongeldige opnamebron.');}
   if(url.origin!=='https://api.rinkel.com'||!url.pathname.startsWith('/audio/call-recording/')||url.username||url.password)throw Error('Onverwachte opnamebron.');
   // The temporary URL already authenticates playback: never forward the API key.
   const r=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000)}),type=r.headers.get('content-type')?.split(';')[0];
   if(!r.ok||!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/webm'].includes(type))throw Error('Opname niet beschikbaar.');
   let size=0;const parts=[];for await(const part of r.body){size+=part.length;if(size>40*1024*1024)throw Error('Opname te groot.');parts.push(part);}return {type,bytes:Buffer.concat(parts)};
  }
 };
}
