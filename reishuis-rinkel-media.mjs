// Read-only Rinkel access. Audio and provider credentials never enter Postgres.
export function createRinkelMedia({key=process.env.RINKEL_READ_API_KEY||'',allowedNumbers=process.env.RINKEL_ALLOWED_NUMBERS||'',fetcher=fetch}={}){
 const allowed=new Set(allowedNumbers.split(',').map(v=>v.trim()));
 const configured=!!key&&allowed.size>0;
 const valid=id=>typeof id==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(id);
 async function json(path){
  const r=await fetcher('https://api.rinkel.com/v1'+path,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Gespreksgegevens zijn nog niet beschikbaar.');
  const body=await r.text();if(body.length>1024*1024)throw Error('Ongeldig antwoord.');return JSON.parse(body).data;
 }
 async function details(call){
  if(!configured||!valid(call?.id))throw Error('Rinkel-opnames zijn nog niet aangesloten.');
  const data=await json('/call-detail-records/by-call-id/'+encodeURIComponent(call.id)+'?includeDetails=true');
  if(data?.callId!==call.id||!allowed.has(data.internalNumber?.number))throw Error('Dit gesprek valt buiten de gekoppelde lijnen.');
  return data;
 }
 return {configured,
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
