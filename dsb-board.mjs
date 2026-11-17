import {XMLParser, XMLValidator} from 'fast-xml-parser';

const catalogue = [
  ['kobenhavn-h', 'København H', '8600626'],
  ['odense', 'Odense', '8600512'],
  ['padborg', 'Padborg', '8600100'],
  ['kolding', 'Kolding', '8600083'],
  ['fredericia', 'Fredericia', '8600079'],
  ['vejle', 'Vejle', '8600073'],
  ['ribe', 'Ribe'],
  ['esbjerg', 'Esbjerg'],
  ['aarhus-h', 'Aarhus H', '8600053'],
  ['aalborg', 'Aalborg St.', '8600020'],
  ['hirtshals', 'Hirtshals'],
  ['osterport', 'Østerport', '8600650'],
  ['nordhavn', 'Nordhavn'],
  ['helsingor', 'Helsingør', '8600669'],
];
export const dsbStations = Object.freeze(Object.fromEntries(catalogue.map(([page, name, id]) => [page, {name, id}])));

const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+st\.?$/,'');
const stationNames = new Map(catalogue.map(([page, name]) => [normalize(name),page]));
const stationIds = new Map(catalogue.filter(([, , id]) => id).map(([page, , id]) => [id,page]));
const parser = new XMLParser({removeNSPrefix:true,parseTagValue:false,processEntities:false});
const clock = new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Copenhagen',hour:'2-digit',minute:'2-digit'});
const day = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'});
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => String(value?.['#text'] ?? (typeof value === 'string' ? value : '')).trim();
const flag = value => /^(true|1)$/i.test(text(value));
const stamp = value => Date.parse(text(value));

export function parseDsbMessage(xml, now=Date.now()) {
  if(typeof xml!=='string'||xml.length>4_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return [];
  const doc=parser.parse(xml);
  const rows=[];
  for(const delivery of list(doc.Siri?.ServiceDelivery?.EstimatedTimetableDelivery)){
    const deliveredAt=stamp(delivery.ResponseTimestamp);
    for(const frame of list(delivery.EstimatedJourneyVersionFrame)){
      for(const journey of list(frame.EstimatedVehicleJourney)){
        const ref=text(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef||journey.DatedVehicleJourneyRef);
        if(!ref)continue;
        const observedAt=stamp(journey.RecordedAtTime)||deliveredAt||now;
        const train=text(journey.PublishedLineName)||text(journey.LineRef)||'DSB';
        const destination=text(journey.DestinationName);
        for(const call of list(journey.EstimatedCalls?.EstimatedCall)){
          const stopRef=text(call.StopPointRef);
          const page=stationIds.get(stopRef)||stationNames.get(normalize(text(call.StopPointName)));
          const planned=stamp(call.AimedDepartureTime);
          if(!page||!Number.isFinite(planned))continue;
          const expected=stamp(call.ExpectedDepartureTime);
          const actual=stamp(call.ActualDepartureTime);
          const status=normalize(text(call.DepartureStatus));
          const cancelled=flag(journey.Cancellation)||flag(call.Cancellation)||status==='cancelled';
          const skipped=Number.isFinite(actual)||status==='departed';
          const delay=Number.isFinite(expected)?Math.round((expected-planned)/60000):null;
          const id=JSON.stringify([ref,text(journey.FramedVehicleJourneyRef?.DataFrameRef)||day.format(planned),stopRef||page,text(call.Order)]);
          rows.push({page,observedAt,skipped,row:{
            id,source:'DSB',train,plannedTimestamp:planned,expectedTimestamp:Number.isFinite(expected)?expected:planned,
            plannedTime:clock.format(planned),time:clock.format(Number.isFinite(expected)?expected:planned),
            to:destination||'Onbekend',track:text(call.DeparturePlatformName)||'—',cancelled,delay,
            status:cancelled?'Geannuleerd':delay>0?'+'+delay:delay===0?'Op tijd':'',
            type:cancelled?'cancel':delay>0?'delay':'normal',hasRealtime:cancelled||Number.isFinite(expected),
          }});
        }
      }
    }
  }
  return rows;
}

export function createDsbBoards(){
  const boards=new Map();
  let receivedAt=null;
  const prune=(entries,now)=>{
    for(const [key,item] of entries)if(Math.max(item.row.plannedTimestamp,item.row.expectedTimestamp)<now-300000)entries.delete(key);
  };
  return {
    ingest(xml,now=Date.now()){
      for(const entry of parseDsbMessage(xml,now)){
        if(entry.row.plannedTimestamp<now-3600000||entry.row.plannedTimestamp>now+86400000)continue;
        const entries=boards.get(entry.page)||new Map();
        boards.set(entry.page,entries);
        prune(entries,now);
        const old=entries.get(entry.row.id);
        if(old&&entry.observedAt<old.observedAt)continue;
        if(old){
          if(entry.row.to==='Onbekend')entry.row.to=old.row.to;
          if(entry.row.track==='—')entry.row.track=old.row.track;
        }
        entries.set(entry.row.id,entry);
      }
      receivedAt=now;
    },
    board(page,now=Date.now()){
      if(!Object.hasOwn(dsbStations,page))return null;
      const station=dsbStations[page].name;
      const entries=boards.get(page)||new Map();
      prune(entries,now);
      const rows=[...entries.values()].filter(item=>!item.skipped).map(item=>item.row)
        .sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp).slice(0,60);
      return {source:'Rejseplanen / DSB (SIRI-ET)',page,station,title:station,country:'DK',layout:'all-departures',
        lastScanAt:entries.size?new Date(Math.max(...[...entries.values()].map(item=>item.observedAt))).toISOString():null,
        status:receivedAt&&now-receivedAt<600000?'ready':'unavailable',
        notice:'Uitsluitend ritten waarvoor de DSB-feed een update heeft geleverd.',
        departures:{all:rows,fernverkehr:[],regional:[]}};
    },
  };
}

export function dsbBody(body){
  return typeof body==='string'?body:body instanceof Uint8Array?Buffer.from(body).toString('utf8'):'';
}

const dsbBoards=createDsbBoards();
export const dsbBoard=dsbBoards.board;

export async function startDsb(){
  const {DSB_SIRI_CLIENT_ID,DSB_SIRI_TENANT_ID,DSB_SIRI_CLIENT_SECRET,DSB_SIRI_AMQP_URL}=process.env;
  if(!DSB_SIRI_CLIENT_ID||!DSB_SIRI_TENANT_ID||!DSB_SIRI_CLIENT_SECRET||!DSB_SIRI_AMQP_URL)return;
  let bus;
  try{
    const address=new URL(DSB_SIRI_AMQP_URL.trim());
    const [topic,subscription]=address.pathname.split('/').filter(Boolean);
    if(address.protocol!=='amqps:'||address.hostname!=='sb-duvproddistribution.servicebus.windows.net'||topic!=='t-distribution-785'||!subscription)throw Error('invalid endpoint');
    const [{ServiceBusClient},{ClientSecretCredential}]=await Promise.all([import('@azure/service-bus'),import('@azure/identity')]);
    const credential=new ClientSecretCredential(DSB_SIRI_TENANT_ID.trim(),DSB_SIRI_CLIENT_ID.trim(),DSB_SIRI_CLIENT_SECRET.trim());
    bus=new ServiceBusClient(address.hostname,credential);
    const receiver=bus.createReceiver(topic,subscription);
    let lastError=0;
    receiver.subscribe({
      async processMessage(message){
        const xml=dsbBody(message.body);
        if(xml)dsbBoards.ingest(xml);
      },
      async processError(){
        const now=Date.now();
        if(now-lastError>=60000){lastError=now;console.warn('[DSB] Ontvanger tijdelijk niet bereikbaar.');}
      },
    });
  }catch{
    await bus?.close().catch(()=>{});
    console.warn('[DSB] Ontvanger kon niet worden gestart.');
  }
}
