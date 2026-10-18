// Operational rules for number alerts, not a statement about ticket/reservation validity.
export const trainDigits=value=>(String(value||'').match(/\d+[a-z]?$/i)?.[0]?.toUpperCase()||'').replace(/^0+(?=\d)/,'');
export function trainKind(value){
 const kind=String(value||'').replace(/\s/g,'').toUpperCase().replace(/\d+[A-Z]?$/,'');
 return ({EUROCITY:'EC',RAILJET:'RJ',FRECCIAROSSA:'FR',NIGHTJET:'NJ'})[kind]||kind;
}
export const numberException=leg=>trainKind(leg.train_number)==='NJ'||trainKind(leg.train_number).startsWith('TGV');
export function reservationStatus(leg,observation){
 const explicit=observation?.reservation_status||leg.reservation_status||leg.observation?.reservation_status;
 if(['reserved','unreserved'].includes(explicit))return explicit;
 return ['ICE','RJ','ECE','FR','EC'].includes(trainKind(leg.train_number))?'reserved':'unreserved';
}
export function numberAssessment(leg,o={}){
 o||={};
 const before=trainDigits(leg.train_number),after=trainDigits(o.train_number);
 const changed=!!before&&!!after&&before!==after;
 const exception=numberException(leg),reserved=reservationStatus(leg,o)==='reserved';
 return {changed,notify:changed&&reserved&&!exception,reserved,exception,before:leg.train_number,after:o.train_number||leg.train_number};
}
export function controlPolicy(row){
 const items=(row.control?.sources||[]).flatMap(s=>{try{return [JSON.parse(s)];}catch{return [];}});
 return items.findLast(s=>s.kind==='train-number-policy')||{};
}
export function dbVerificationMatches(leg,o,now){
 const v=leg.db_verification;if(!v||now-Date.parse(v.observed_at)>4*3600000)return false;
 return ['departure_date','departure_time','arrival_date','arrival_time','cancelled'].every(k=>v[k]===o[k])&&trainDigits(v.train_number||leg.train_number)===trainDigits(o.train_number||leg.train_number);
}
export function applyNumberPolicy(leg,result,now=Date.now()){
 if(!result?.observation)return result;
 const observation={...result.observation,reservation_status:result.observation.reservation_status||leg.observation?.reservation_status||leg.reservation_status||'auto'};
 const n=numberAssessment(leg,observation),extraDb=trainKind(leg.train_number)==='NJ'&&observation.source==='NDOV IFF'&&!dbVerificationMatches(leg,observation,now);
 if(observation.train_number===''&&n.reserved&&!n.exception)return {sourceConflict:true,reason:'Treinnummer ontbreekt in de bron; treinnummer en reservering handmatig controleren.',sources:result.sources||[]};
 const messages=[];
 if(n.changed)messages.push(`Treinnummer gewijzigd. Was ${n.before}; nu ${n.after}. ${n.notify?'Reservering en nieuw treinnummer beoordelen.':n.exception?'Geaccepteerd volgens de Nightjet/TGV-afspraak.':'Geaccepteerd: zonder reservering.'}`);
 if(extraDb)messages.push('Nightjet via NDOV gecontroleerd; aanvullende DB-controle nodig.');
 if(!messages.length)return {...result,observation};
 const timestamps=(result.sources||[]).flatMap(s=>{try{return [JSON.parse(s).downloaded_at];}catch{return [];}}).filter(Boolean);
 const evidence={kind:'train-number-policy',source:'Nummercontrole',downloaded_at:timestamps.sort()[0]||new Date(now).toISOString(),number_changed:n.changed,notification_required:n.notify,original_number:n.before,current_number:n.after,reservation_status:reservationStatus(leg,observation),extra_db_required:extraDb};
 return {...result,observation,reason:[result.reason,...messages].filter(Boolean).join(' '),sources:[...(result.sources||[]),JSON.stringify(evidence)]};
}
