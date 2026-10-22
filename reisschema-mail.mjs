import {randomBytes,createHash} from 'node:crypto';
import {assess} from './reisschema-control.mjs';
export const digest=s=>createHash('sha256').update(s).digest('hex');
export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
export function composeChangeMail(row,{destination,advice,receiptUrl,signature}){
 if(!row.observation||!row.observation_revision||!assess(row,row.observation).changed)throw Error('Geen actuele wijziging');
 for(const value of [destination,advice])if(typeof value!=='string'||!value.trim()||value.length>3000||/[\r\n]/.test(destination))throw Error('Bestemming en gecontroleerd advies vereist');
 const o=row.observation,a=assess(row,o),day=date(row.travel_date),d=escapeHtml(destination),nr=escapeHtml(row.dossier);
 const subject=a.departure<=-4?`Belangrijk: uw trein naar ${destination} op ${day} vertrekt eerder – ${row.dossier}`:`Belangrijk: reisschema aangepast voor uw reis naar ${destination} op ${day} – ${row.dossier}`;
 const time=(oldDate,oldTime,newDate,newTime)=>`${escapeHtml(date(oldDate))} <del>${escapeHtml(oldTime)}</del><br>${escapeHtml(date(newDate))} <strong>${escapeHtml(newTime)}</strong>`;
 const html=`<p>Voor uw reis naar ${d} op ${day} heeft mijn automatische assistent uw reisschema gecontroleerd en een wijziging gevonden. Daarom ontvangt u van ons deze update.</p>
<p>${escapeHtml(row.train_number)}: ${escapeHtml(row.from_station)} → ${escapeHtml(row.to_station)}</p>${o.train_number&&a.reservationReview?'<p><strong>Treinnummer volgens de controle: '+escapeHtml(o.train_number)+'</strong></p>':''}${o.station_changed?'<p><strong>Nieuw traject: '+escapeHtml(o.departure_station)+' → '+escapeHtml(o.arrival_station)+'</strong></p>':''}
<p>Vertrek: ${time(row.travel_date,row.departure_time,o.departure_date,o.departure_time)}<br>Aankomst: ${time(row.arrival_date||row.travel_date,row.arrival_time,o.arrival_date,o.arrival_time)}</p>
${o.cancelled?'<p><strong>Deze trein vervalt volgens de gecontroleerde bron.</strong></p>':''}${o.connection_broken?'<p><strong>De aansluiting is niet meer haalbaar.</strong></p>':''}
<p>${escapeHtml(advice).replace(/\n/g,'<br>')}</p><p><a href="${escapeHtml(receiptUrl)}">Ontvangst bevestigen</a></p>
<p>Heeft u vragen over de wijziging? Neem gerust contact met ons op, bijvoorbeeld door deze e-mail te beantwoorden. U krijgt dan antwoord van iemand uit ons team.</p>${signature}`;
 return {subject,html,dossier:nr};
}
export function createChangeMail({register,read,write,gmail,origin,clock=Date.now}){
 const current=async(id,key,revision)=>{const state=await register.summary();if(!state.available)throw Error('Register niet bereikbaar');let row=state.legs.find(r=>r.leg_id===id&&r.status==='active'&&r.observation?.change_key===key&&r.observation_revision===revision);if(!row&&register.notificationContexts)row=(await register.notificationContexts()).find(r=>r.leg_id===id&&r.active_replacement_version&&r.observation?.change_key===key&&r.observation_revision===revision);if(!row)throw Error('Wijziging niet meer actueel');return row;};
 return {
  status:()=>gmail.status(),
  async draft({legId,changeKey,observationRevision,to,destination,advice}){
   if(typeof to!=='string'||! /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(to)||to.length>254)throw Error('Controleer het e-mailadres');
   const row=await current(legId,changeKey,observationRevision),identity=[legId,changeKey,observationRevision],key='reisschema-draft-'+digest(JSON.stringify(identity));
   const verified=row.notification_context?Date.parse(row.replacement_checked_at):row.control?.outcome==='checked'&&row.control.observation_request_id===row.observation.request_id?Date.parse(row.control.checked_at):NaN;
   if(!Number.isFinite(verified)||clock()-verified>86400000)throw Error('Eerst de actuele wijziging controleren');
   const old=await read(key);
   if(old.value.draftId){await register.recordLegEvent(row.version_id,'draft',{leg_id:legId,request_id:'draft-'+digest(key),change_key:changeKey,observation_revision:observationRevision,created_at:old.value.started,draft_id:old.value.draftId});return {draftId:old.value.draftId,existing:true};}
   if(old.value.started)throw Error('Eerdere conceptaanvraag niet bevestigd. Controleer Gmail voordat opnieuw een concept wordt aangemaakt.');
   const alias=await gmail.alias();
   if(alias.sendAsEmail!=='contact@treinrondreis.nl'||alias.verificationStatus!=='accepted'||!alias.signature?.trim())throw Error('Verifieer afzenderalias en bestaande handtekening');
   const token=randomBytes(32).toString('base64url'),tokenKey='reisschema-receipt-'+digest(token),receiptUrl=origin+'/reisschema-ontvangst/'+token;
   const message=composeChangeMail(row,{destination,advice,receiptUrl,signature:alias.signature});
   const now=new Date(clock()).toISOString(),record={legId,versionId:row.version_id,changeKey,observationRevision,createdAt:now,expires:clock()+90*86400000};
   await write(tokenKey,record,0);
   // Persist before the external POST; an ambiguous timeout is never blindly retried.
   const revision=await write(key,{started:now,identity},old.revision);
   await current(legId,changeKey,observationRevision);
   const draft=await gmail.createDraft({to,subject:message.subject,html:message.html});
   await write(key,{started:now,identity,draftId:draft.id},revision);
   await register.recordLegEvent(row.version_id,'draft',{leg_id:legId,request_id:'draft-'+digest(key),change_key:changeKey,observation_revision:observationRevision,created_at:now,draft_id:draft.id});
   return {draftId:draft.id,existing:false};
  },
  async receipt(token,confirm=false){
   if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Ongeldige link');
   const key='reisschema-receipt-'+digest(token),stored=await read(key),r=stored.value;
   if(!r.legId||r.expires<clock())throw Error('Link verlopen');
   const row=await current(r.legId,r.changeKey,r.observationRevision);
   if(!confirm)return {confirmed:!!row.receipt};
   if(row.communication?.change_key!==r.changeKey)throw Error('Verzending is nog niet geregistreerd');
   const at=r.confirmedAt||new Date(clock()).toISOString();
   if(!r.confirmedAt)await write(key,{...r,confirmedAt:at},stored.revision);
   await register.recordLegEvent(r.versionId,'receipt',{leg_id:r.legId,request_id:'receipt-'+digest(token),change_key:r.changeKey,observation_revision:r.observationRevision,confirmed_at:at});
   return {confirmed:true};
  }
 };
}
