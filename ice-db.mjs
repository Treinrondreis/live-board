const stationKey=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace('duesseldorf','dusseldorf').replace(/\(main\)|\(m\)/g,'').replace(/fernbf|fernb/g,'fern').replace(/[^a-z0-9]/g,'').replace(/^frankfurtflughafen(?:fern)?$/,'frankfurtflughafenfern');
export const sameIceStation=(a,b)=>stationKey(a)===stationKey(b);

// Reuse existing station collection only. Retrieval time is not event realization.
export function iceDbEvidence(journey,ndovReports,rows,now){
 const odd=Number(journey.number)%2===1,stops=journey.stops;
 const boundary=stops.findIndex(s=>s.country==='NL'&&['AH','HGL'].includes(s.code));
 const checkpoint=stops.findIndex(s=>['badbentheim','dusseldorfhbf'].includes(stationKey(s.name)));
 const firstNl=stops.find(s=>s.country==='NL');
 const passedAt=code=>ndovReports.some(r=>r.departed&&r.stationShortCode===code&&Number.isFinite(r.expectedTimestamp||r.plannedTimestamp)&&(r.expectedTimestamp||r.plannedTimestamp)<=now+60000&&r.messageTimestamp<=now+60000);
 const passed=boundary>=0&&passedAt(stops[boundary].code);
 const entered=passedAt(firstNl?.code);
 if(odd&&!passed)return {row:null,reason:'DB na gemeld vertrek uit Arnhem of Hengelo'};
 if(!odd&&(checkpoint<0||entered))return {row:null,reason:entered?'Nederlandse vertrekmelding beschikbaar':'Geen passende Duitse overdrachtshalte in de dienstregeling'};
 const candidates=[];
 for(const r of rows){
  if(String(r.number)!==journey.number||r.serviceDate!==journey.serviceDate||String(r.category).toUpperCase()!=='ICE'||!r.hasRealtime)continue;
  const index=stops.findIndex(s=>s.country!=='NL'&&sameIceStation(s.name,r.observedAt));
  if(index<0||(odd?index<=boundary:index>checkpoint))continue;
  const stop=stops[index],mode=r.eventMode==='arrival'?'arrival':'departure',planned=stop[mode];
  if(!Number.isFinite(planned)||Math.abs(r.plannedTimestamp-planned)>5*60000)continue;
  const received=Date.parse(r.retrievedAt||'');
  if(!Number.isFinite(received)||now-received>15*60000||received>now+60000)continue;
  const event=r.expectedTimestamp||r.plannedTimestamp;
  if(event<now-3600000||event>now+90*60000)continue;
  candidates.push({...r,source:'DB',messageTimestamp:received,timestampKind:'retrieved',departed:false});
 }
 candidates.sort((a,b)=>{
  const at=a.expectedTimestamp||a.plannedTimestamp,bt=b.expectedTimestamp||b.plannedTimestamp;
  return Number(at<now)-Number(bt<now)||(at<now?bt-at:at-bt)||b.messageTimestamp-a.messageTimestamp;
 });
 return {row:candidates[0]||null,reason:candidates.length?'Passende recente DB-verwachting':'Geen passende recente DB-melding beschikbaar'};
}

export function iceEndpoint(stop,mode,reports,dbRows,now,stationName=stop?.name){
 const planned=stop?.[mode];
 const matches=[...reports,...(stop?.country==='NL'?[]:dbRows).map(r=>({...r,source:'DB',messageTimestamp:Date.parse(r.retrievedAt||'')}))].filter(r=>sameIceStation(r.observedAt,stationName)&&r.eventMode===mode&&Number.isFinite(planned)&&Math.abs(r.plannedTimestamp-planned)<=5*60000&&r.hasRealtime&&Number.isFinite(r.delay)&&now-r.messageTimestamp<=15*60000&&r.messageTimestamp<=now+60000);
 const row=matches.sort((a,b)=>b.messageTimestamp-a.messageTimestamp)[0];
 return {station:stationName,mode,planned:Number.isFinite(planned)?planned:null,expected:row&&!row.cancelled?row.expectedTimestamp:null,source:row?.source||null,basis:row?'Bronverwachting, geen bevestigde realisatie':'Alleen dienstregeling; actuele tijd onbekend'};
}
