import {iceDbEvidence,iceEndpoint,sameIceStation} from './ice-db.mjs';
// Public train observations only; no customer or booking information.
const coordinates={ASD:[4.9003,52.378],UT:[5.1103,52.0894],AH:[5.9008,51.985],AMF:[5.374,52.154],DV:[6.161,52.257],HGL:[6.794,52.262],SHL:[4.762,52.309],RTD:[4.469,51.925],BD:[4.78,51.595],EHV:[5.481,51.443],ZL:[6.091,52.505]};
const fresh=(row,now)=>Number.isFinite(row.messageTimestamp)&&now-row.messageTimestamp>=-60000&&now-row.messageTimestamp<=15*60000;

// Interpolate only between two fresh forecasts after a reported departure.
// These departure-to-departure estimates are not GPS or confirmed arrivals.
export function estimateIcePosition(stops,now){
 for(let i=0;i<stops.length-1;i++){
  const a=stops[i],b=stops[i+1],start=a.expectedTimestamp,end=b.expectedTimestamp;
  const from=coordinates[a.stationShortCode],to=coordinates[b.stationShortCode];
  if(!a.departed||a.cancelled||b.cancelled||a.notBoardable||b.notBoardable||!a.hasRealtime||!b.hasRealtime||now-a.messageTimestamp>3*3600000||!fresh(b,now))continue;
  if(!from||!to||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>3*3600000||now<start||now>=end)continue;
  const fraction=(now-start)/(end-start);
  return {kind:'estimated',coordinates:from.map((v,j)=>v+(to[j]-v)*fraction),from:a.observedAt,to:b.observedAt,label:`Geschatte positie tussen ${a.observedAt} en ${b.observedAt}`,basis:'Tussen vertrekverwachtingen; rechte lijn, geen exacte spoorroute',messageAt:new Date(Math.min(a.messageTimestamp,b.messageTimestamp)).toISOString()};
 }
 const last=stops.filter(r=>r.departed&&r.plannedTimestamp<=now&&coordinates[r.stationShortCode]).at(-1);
 const report=last||stops.find(r=>coordinates[r.stationShortCode]);
 return {kind:'station',coordinates:report?coordinates[report.stationShortCode]:null,label:report?`Stationsmelding ${report.observedAt} · geen voertuiglocatie`:'Geen locatie beschikbaar',basis:'Geen betrouwbare schatting beschikbaar',messageAt:report?new Date(report.messageTimestamp).toISOString():null};
}
export function iceRadar(rows,now=Date.now(),options={}){
 const hour=3600000,groups=new Map();
 for(const row of rows){
  if(row.source!=='NDOV'||String(row.category).toUpperCase()!=='ICE'||!row.number||!Number.isFinite(row.plannedTimestamp)||!Number.isFinite(row.messageTimestamp))continue;
  const key=`${row.serviceDate}|${row.number}`,list=groups.get(key)||[];
  list.push(row);groups.set(key,list);
 }
 const journeys=options.journeys||[];
 const candidates=journeys.length?journeys:[...groups.entries()].map(([id,list])=>({id,number:list[0].number,serviceDate:list[0].serviceDate,from:null,to:list.at(-1).to,incomplete:true,stops:list.map(r=>({code:r.stationShortCode,name:r.observedAt,country:'NL',departure:r.plannedTimestamp}))}));
 const unique=new Map();
 for(const journey of candidates){
  const key=`${journey.serviceDate}|${journey.number}`;
  if(!unique.has(key)||unique.get(key).stops.length<journey.stops.length)unique.set(key,journey);
 }
 const trains=[];
 for(const [id,j] of unique){
  const nl=j.stops.filter(s=>s.country==='NL');if(!nl.length)continue;
  const first=nl[0],last=nl.at(-1),observations=groups.get(id)||[];
  const reports=nl.map(s=>{
   const expected=s.departure??s.arrival;
   return observations.filter(r=>(r.stationShortCode||r.stationCode)===s.code&&Math.abs(r.plannedTimestamp-expected)<=5*60000).sort((a,b)=>b.messageTimestamp-a.messageTimestamp)[0];
  }).filter(Boolean);
  const lastReport=[...reports].sort((a,b)=>b.messageTimestamp-a.messageTimestamp)[0];
  const freshReports=reports.filter(r=>fresh(r,now)&&options.feedFresh!==false);
  const startPlanned=first.arrival??first.departure,endPlanned=last.departure??last.arrival;
  if(!Number.isFinite(startPlanned)||!Number.isFinite(endPlanned))continue;
  const startReport=reports.find(r=>r.stationShortCode===first.code),endReport=reports.find(r=>r.stationShortCode===last.code);
  const usable=r=>r?.hasRealtime&&!r.cancelled&&Number.isFinite(r.delay)&&(r.departed||fresh(r,now)&&options.feedFresh!==false);
  const onward=[...freshReports].filter(usable).sort((a,b)=>b.plannedTimestamp-a.plannedTimestamp)[0];
  const startBasis=usable(startReport)?startReport:null,endBasis=usable(endReport)?endReport:onward;
  const start=startPlanned+(startBasis?startBasis.delay*60000:0);
  const end=endPlanned+(endBasis?endBasis.delay*60000:0);
  const timeBasis=r=>r?`Berekend met vertrek${r.departed?'melding':'verwachting'} ${r.observedAt}, bron ${new Date(r.messageTimestamp).toISOString()}`:'Alleen dienstregeling; geen realtimeverwachting';
  if(start>now+hour||end<now-hour)continue;
  const latestFresh=[...freshReports].sort((a,b)=>b.messageTimestamp-a.messageTimestamp)[0];
  const completed=end<now;
  const phase=completed?'recent':start>now?(j.stops[0].country==='NL'?'departing':'approaching'):'in-nl';
  const phaseLabel={recent:'NL-traject afgelopen (verwacht)',departing:'Vertrekt binnen 60 minuten',approaching:'Nadert Nederland (verwacht)', 'in-nl':'In Nederland (verwacht)'}[phase];
  const dbRows=(options.dbRows||[]).filter(r=>String(r.number)===j.number&&r.serviceDate===j.serviceDate);
  const db=iceDbEvidence(j,reports,dbRows,now);
  const chosen=db.row||latestFresh||lastReport;
  const current=Boolean(chosen&&fresh(chosen,now)&&(chosen.source==='DB'||options.feedFresh!==false));
  const measured=Boolean(chosen?.hasRealtime&&!chosen.cancelled&&Number.isFinite(chosen.delay));
  const evidence=chosen?{source:chosen.source||'NDOV',timestampKind:chosen.timestampKind||'message',station:chosen.observedAt,mode:chosen.eventMode||'departure',kind:chosen.cancelled?'cancelled-stop':chosen.departed?'reported-departure':'forecast',timestamp:new Date(chosen.messageTimestamp).toISOString(),ageMinutes:Math.max(0,Math.floor((now-chosen.messageTimestamp)/60000)),current,delay:measured?chosen.delay:null}:null;
  const estimate=estimateIcePosition(reports.sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp),now);
  const position=!completed&&current&&estimate.kind==='estimated'?estimate:{kind:'unavailable',coordinates:null,label:'Geen betrouwbare voertuigpositie',basis:'Zie de bronmelding in de rittenlijst'};
  const delay=measured&&(current||chosen.departed)?chosen.delay:null;
  const destination=latestFresh?.to||j.to||last.name;
  const departure=iceEndpoint(j.stops[0],'departure',reports,dbRows,now);
  const arrival=iceEndpoint(sameIceStation(destination,j.stops.at(-1).name)?j.stops.at(-1):null,'arrival',reports,dbRows,now,destination);
  const nextNlTime=nl.map(s=>{
   const planned=s.departure??s.arrival,report=reports.find(r=>r.stationShortCode===s.code);
   return planned+(usable(report)?report.delay*60000:0);
  }).filter(time=>Number.isFinite(time)&&time>=now).sort((a,b)=>a-b)[0]??end;
  trains.push({id,number:j.number,from:j.from||first.name,to:destination,departure,arrival,dbStatus:db.reason,routeLabel:j.incomplete?'Alleen bekende Nederlandse haltes':'Volledig traject volgens NDOV-dienstregeling',phase,phaseLabel,phaseBasis:'Trajectstatus berekend uit dienstregeling en beschikbare vertraging; geen bevestigde grenspassage of aankomst',nlStart:{station:first.name,planned:startPlanned,expected:start,basis:timeBasis(startBasis)},nlEnd:{station:last.name,planned:endPlanned,expected:end,basis:timeBasis(endBasis),mode:last.departure?'departure':'arrival'},incomplete:Boolean(j.incomplete),station:chosen?.observedAt||'',delay,delayKind:current?'current':chosen?.departed?'historical':'unknown',stale:!current,messageAt:chosen?new Date(chosen.messageTimestamp).toISOString():null,evidence,position,plannedTimestamp:startPlanned,stops:nl.map(s=>({station:s.name,plannedTimestamp:s.departure??s.arrival,mode:s.departure?'departure':'arrival',delay:null})),sortTime:phase==='recent'?-end:phase==='in-nl'?nextNlTime:start});
 }
 const rank={'in-nl':0,approaching:1,departing:1,recent:2};
 const chronological=(a,b)=>rank[a.phase]-rank[b.phase]||a.sortTime-b.sortTime||a.number.localeCompare(b.number);
 const sort=options.sort==='delay'?'delay':'route';
 trains.sort(sort==='delay'?(a,b)=>Number(!Number.isFinite(a.delay))-Number(!Number.isFinite(b.delay))||(Number.isFinite(a.delay)&&Number.isFinite(b.delay)?b.delay-a.delay:0)||chronological(a,b):chronological);
 const focused=options.focus?trains.findIndex(t=>t.id===options.focus):-1;
 const requested=focused>=0?Math.floor(focused/12):options.page;
 const page=Math.min(Math.max(0,Number.isInteger(requested)?requested:0),Math.max(0,Math.ceil(trains.length/12)-1));
 return {source:'NDOV InfoPlus + IFF-dienstregeling',generatedAt:new Date(now).toISOString(),feedFresh:options.feedFresh!==false,lastMessageAt:options.lastMessageAt||null,coverage:journeys.length?'full-schedule':'partial-observations',total:trains.length,page,pageSize:12,sort,pages:Math.ceil(trains.length/12),mapTrains:trains.filter(t=>t.position.kind==='estimated'),trains:trains.slice(page*12,page*12+12)};
}
