const bookingId=r=>JSON.stringify([r.dossier,r.booking_key||'']);
import {numberAssessment,controlPolicy,manualControlAttention} from './reisschema-number-policy.mjs';
import {punctualityView} from './punctuality-view.mjs';
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=s=>String(s||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
 const minute=(day,time)=>day&&time?Date.parse(day+'T'+time+':00Z')/60000:NaN;
 function changeState(r){
  const o=r.observation;
  if(!o)return {alert:false,changed:false,communicated:false};
  const changed=o.departure_time!==r.departure_time||o.departure_date!==r.travel_date||o.arrival_time!==r.arrival_time||o.arrival_date!==(r.arrival_date||r.travel_date)||o.cancelled||o.connection_broken||o.station_changed||numberAssessment(r,o).notify;
  const earlier=minute(r.travel_date,r.departure_time)-minute(o.departure_date,o.departure_time);
  return {changed,earlier,alert:earlier>=4||o.cancelled||o.station_changed||(o.connection_broken&&!o.backup_communicated),communicated:changed&&r.communication?.change_key===o.change_key};
 }
 const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 const documentLink=(value,label='Reisschema openen',primary=false)=>{const url=safeLink(value);return url?'<a class="'+(primary?'document-button':'')+'" target="_blank" rel="noopener noreferrer" href="'+escape(url)+'">'+escape(label)+' ↗</a>':'<span class="muted">Geen documentlink beschikbaar</span>';};
 const sortLegs=rows=>[...rows].sort((a,b)=>String(a.travel_date||'').localeCompare(String(b.travel_date||''))||Number(a.sequence||0)-Number(b.sequence||0)||String(a.departure_time||'').localeCompare(String(b.departure_time||'')));
export function journeyTable(rows,withBooking=false,{checkedLegs=new Set(),interactive=true}={}){
  const heads=withBooking?['Selectie','Melding','Boeking','Reisdatum','Trein / vervoer','Vertrek','Traject','Aankomst','Reisschema','Controle']:['Selectie','Melding','Trein / vervoer','Vertrek','Traject','Aankomst','Controle'];
  const timeCell=(r,mode)=>{
   const isArrival=mode==='arrival',old=r[mode+'_time'],oldDate=isArrival?(r.arrival_date||r.travel_date):r.travel_date;
   const next=r.observation?.[mode+'_time'],nextDate=r.observation?.[mode+'_date'];
   const changed=next&&(next!==old||nextDate!==oldDate);
   const showDate=(day)=>day&&day!==r.travel_date?'<span class="arrival-date">'+escape(date(day))+'</span>':'';
   const p=punctualityView(r,mode),displayed=changed?next:old;
   const measured=p?'<span class="punctuality-current" title="'+escape(p.kind)+'"><span class="source-note">Actueel</span>'+(p.cancelled?'<strong>Uitval</strong>':p.label?'<span class="delay-minutes" aria-label="Vertraging in minuten">'+escape(p.label)+'</span>':p.delay===0?'<strong>Op tijd</strong>':'<strong>Onbekend</strong>')+'</span>':'';
   const planned=(p?'<span class="source-note">Gepland</span>':'')+(changed?'<del aria-label="Tijd uit reisschema">'+escape(old||'Onbekend')+showDate(oldDate)+'</del><strong class="new-time" aria-label="Nieuwe gecontroleerde tijd">'+escape(next)+showDate(nextDate)+'</strong>':'<strong>'+escape(old||'Onbekend')+'</strong>'+showDate(oldDate));
   return '<td class="time-cell"><span class="punctuality-times"><span>'+planned+'</span>'+measured+'</span>'+(p&&p.planned!==displayed?'<span class="source-note">Bronplanning '+escape(p.planned)+'</span>':'')+'</td>';
  };
  return '<table class="journey-table"><thead><tr>'+heads.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+sortLegs(rows).map(r=>{
   const c=changeState(r),messages=[],policy=controlPolicy(r),number=numberAssessment(r,r.observation);
   if(number.notify)messages.push('<span class="badge">Nr.</span>');
   if(policy.extra_db_required)messages.push('<span class="badge">DB</span>');
   if(c.alert)messages.push('<span class="attention" role="img" aria-label="Aandacht nodig" title="'+escape(r.observation.cancelled?'Trein vervalt':r.observation.connection_broken&&!r.observation.backup_communicated?'Aansluiting niet haalbaar; geen back-up gecommuniceerd':'Vertrek minimaal vier minuten vervroegd')+'">!</span>');
   if(c.communicated)messages.push('<span class="communicated" role="img" aria-label="Wijziging gecommuniceerd" title="Gecommuniceerd op '+escape(new Date(r.communication.communicated_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}))+'">✓</span>');
   let source=r.observation?'<span class="source-note">'+escape(r.observation.source)+' · bron geraadpleegd '+escape(new Date(r.observation.observed_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}))+'</span>':'<span class="source-note">Nog geen gekoppelde controle</span>';
   if(r.control){source+='<span class="source-note">Controle '+escape(new Date(r.control.checked_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}))+'</span>';if(manualControlAttention(r))source+='<strong class="manual-task">Handmatig controleren: '+escape(r.control.reason)+' <a href="https://int.bahn.de/nl" target="_blank" rel="noopener noreferrer">DB openen ↗</a></strong>';else if(r.control.outcome==='manual')source+='<span class="source-note">Niet gecontroleerd: '+escape(r.control.reason)+'</span>';else if(r.control.assessment?.tightConnectionReview)source+='<strong class="manual-task">Aansluiting en eerder gecommuniceerde back-up beoordelen</strong>';}
   if(r.control?.outcome==='checked'&&r.control.reason)source+='<span class="control-reason '+(number.notify||policy.extra_db_required?'manual-task':'source-note')+'">'+escape(r.control.reason)+(policy.extra_db_required?' <a href="https://int.bahn.de/nl" target="_blank" rel="noopener noreferrer">Extra DB-controle openen ↗</a>':'')+'</span>';
   if(r.draft)source+='<span class="source-note">Concept aangemaakt; verzending afzonderlijk registreren</span>';
   if(r.control?.assessment?.reservationReview)source+='<strong class="manual-task">Reservering beoordelen</strong>';
   if(r.control?.assessment?.backupReview)source+='<span class="source-note">Eerder gecommuniceerde back-up opnieuw beoordelen</span>';
   if(r.control?.assessment?.draftRequired&&!c.communicated)source+='<strong class="manual-task">Conceptmail voorbereiden</strong>';
   if(r.control?.assessment?.arrival>0)source+='<span class="source-note">Latere aankomst: reisgevolgen beoordelen</span>';
   if(r.last_planning_ok_at)source+='<span class="source-note">Laatst zonder vastgestelde afwijking: '+escape(new Date(r.last_planning_ok_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}))+'</span>';
   if(r.observation?.station_changed)source+='<strong class="manual-task">Nieuw traject: '+escape(r.observation.departure_station)+' → '+escape(r.observation.arrival_station)+(/^NJ\s/i.test(r.train_number)&&r.observation.departure_station!==r.from_station?' · Nightjet-instapstation gewijzigd: Newrest informeren ter voorkoming van no-show':'')+'</strong>';
   if(r.receipt)source+='<span class="source-note">Ontvangst bevestigd '+escape(new Date(r.receipt.confirmed_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}))+'</span>';
   if(interactive&&Object.keys(r.punctuality||{}).length)source+='<button class="small-button" data-punctuality="'+escape(r.leg_id)+'">Stiptheidshistorie</button>';
   return '<tr class="'+(c.alert||number.notify||policy.extra_db_required?'needs-attention':'')+'"><td class="selection-cell">'+(interactive&&r.leg_id&&r.status==='active'&&['train','ferry'].includes(r.transport_type||'train')?'<input type="checkbox" data-select-leg="'+escape(r.leg_id)+'" aria-label="Selecteer rit '+escape(r.train_number)+' op '+escape(date(r.travel_date))+'"'+(checkedLegs.has(r.leg_id)?' checked':'')+'>':'')+'</td><td class="status-cell">'+messages.join(' ')+'</td>'+(withBooking?'<td><button class="text-button" data-booking="'+escape(bookingId(r))+'">'+escape(r.dossier)+'</button>'+(r.booking_key?'<br><span class="muted">'+escape(r.booking_key)+'</span>':'')+'</td><td>'+escape(date(r.travel_date))+'</td>':'')+'<td class="train-cell"><strong>'+escape(r.train_number||r.transport_type||'Onbekend')+'</strong>'+(number.changed?'<span class="badge">Nu '+escape(number.after)+'</span>':'')+(r.role==='backup'?'<span class="badge">Back-up</span>':'')+(r.observation?.cancelled?'<span class="badge">Vervalt</span>':'')+'</td>'+timeCell(r,'departure')+'<td class="route-cell"><span class="station">'+escape(r.from_station)+'</span><span class="route-arrow" aria-label="naar">→</span><span class="station">'+escape(r.to_station)+'</span>'+source+(r.observation?.connection_broken?'<span class="connection-note">Aansluiting niet haalbaar'+(r.observation.backup_communicated?' · back-up gecommuniceerd':'')+'</span>':'')+'</td>'+timeCell(r,'arrival')+(withBooking?'<td>'+documentLink(r.document_url)+'</td>':'')+'<td>'+(interactive&&r.leg_id?'<button class="small-button" data-edit-leg="'+escape(r.leg_id)+'">Controleren / communicatie</button>':'')+'</td></tr>';
  }).join('')+'</tbody></table>';
 }
