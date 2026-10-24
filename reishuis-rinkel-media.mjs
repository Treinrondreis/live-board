function mediaError(message){return Object.assign(Error(message),{status:502,reishuisSafe:true});}
export function audioType(type,bytes){const t=String(type||'').split(';')[0].trim().toLowerCase(),aliases={'audio/mp3':'audio/mpeg','audio/mpga':'audio/mpeg','audio/x-mpeg':'audio/mpeg','audio/x-m4a':'audio/mp4','audio/m4a':'audio/mp4','audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/vnd.wave':'audio/wav'};if(['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','audio/aac'].includes(aliases[t]||t))return aliases[t]||t;if(!['','application/octet-stream','binary/octet-stream'].includes(t))return null;if(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224)return 'audio/mpeg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE')return 'audio/wav';if(bytes.subarray(4,8).toString()==='ftyp')return 'audio/mp4';if(bytes.subarray(0,4).toString()==='OggS')return 'audio/ogg';return null;}
export function audioRange(value,length){if(!value)return null;const m=String(value).match(/^bytes=(\d*)-(\d*)$/);if(!m||!m[1]&&!m[2])return false;let start=m[1]?Number(m[1]):Math.max(0,length-Number(m[2])),end=m[1]&&m[2]?Math.min(Number(m[2]),length-1):length-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=length)return false;return {start,end};}
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
   const data=await details(call),id=data.callRecording?.id;if(!valid(id))throw mediaError('Voor dit gesprek is geen opname beschikbaar in Rinkel.');
   const stream=await json('/call-recordings/'+encodeURIComponent(id)+'/stream');let url;
   try{url=new URL(stream.url);}catch{throw Error('Ongeldige opnamebron.');}
   if(url.origin!=='https://api.rinkel.com'||!url.pathname.startsWith('/audio/call-recording/')||url.username||url.password)throw Error('Onverwachte opnamebron.');
   // The temporary URL already authenticates playback: never forward the API key.
   url.searchParams.set('download','true');const r=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok)throw mediaError('Rinkel levert de opname niet (HTTP '+r.status+'). Probeer opnieuw.');
   let size=0;const parts=[];for await(const part of r.body){size+=part.length;if(size>40*1024*1024)throw mediaError('Deze opname is groter dan 40 MB en kan hier nog niet worden afgespeeld.');parts.push(part);}const bytes=Buffer.concat(parts),type=audioType(r.headers.get('content-type'),bytes);if(!type||!bytes.length)throw mediaError('Rinkel levert geen herkenbaar audiobestand.');const range=r.headers.get('content-range');if(r.status===206&&range){const m=range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);if(!m||Number(m[1])!==0||Number(m[2])+1!==Number(m[3])||bytes.length!==Number(m[3]))throw mediaError('Rinkel leverde een onvolledige opname. Probeer opnieuw.');}return {type,bytes};
  }
 };
}
