(()=>{
 const el=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=s=>String(s||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
 const normalized=s=>String(s??'').normalize('NFKC').trim().toLowerCase();
 const dossier=s=>normalized(s).replace(/\s/g,'').replace(/-?a$/,'');
 const bookingId=r=>JSON.stringify([r.dossier,r.booking_key||'']);
 const count=(n,one,many)=>n+' '+(n===1?one:many);
 function trainMatches(value,query){
  const v=normalized(value).replace(/\s/g,''),queries=normalized(query).match(/[a-z]+\s*\d+[a-z]?|\d+[a-z]?/g)||[];
  if(!normalized(query))return true;
  return queries.slice(0,50).some(raw=>{const q=raw.replace(/\s/g,'');return q===v||(/^\d+[a-z]?$/.test(q)&&v.match(/\d+[a-z]?$/)?.[0]===q);});
 }
 function routeMatches(r,query){
  const words=normalized(query).replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);
  const route=normalized(r.from_station+' '+r.to_station);let cursor=0;
  return words.every(word=>{const at=route.indexOf(word,cursor);if(at<0)return false;cursor=at+word.length;return true;});
 }
 function inPeriod(r,from,until){
  if(from&&until&&until<from)return false;
  const overlaps=(start,end)=>(!from||end>=from)&&(!until||start<=until);
  return overlaps(r.travel_date,r.arrival_date||r.travel_date)||(r.observation&&overlaps(r.observation.departure_date,r.observation.arrival_date));
 }
 function amsterdamDay(offset=0){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return new Date(Date.parse(today+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
 }
 const minute=(day,time)=>day&&time?Date.parse(day+'T'+time+':00Z')/60000:NaN;
 function changeState(r){
  const o=r.observation;
  if(!o)return {alert:false,changed:false,communicated:false};
  const changed=o.departure_time!==r.departure_time||o.departure_date!==r.travel_date||o.arrival_time!==r.arrival_time||o.arrival_date!==(r.arrival_date||r.travel_date)||o.cancelled||o.connection_broken;
  const earlier=minute(r.travel_date,r.departure_time)-minute(o.departure_date,o.departure_time);
  return {changed,earlier,alert:earlier>=4||o.cancelled||(o.connection_broken&&!o.backup_communicated),communicated:changed&&r.communication?.change_key===o.change_key};
 }
 const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 const documentLink=(value,label='Reisschema openen',primary=false)=>{const url=safeLink(value);return url?'<a class="'+(primary?'document-button':'')+'" target="_blank" rel="noopener noreferrer" href="'+escape(url)+'">'+escape(label)+' ↗</a>':'<span class="muted">Geen documentlink beschikbaar</span>';};
 const sortLegs=rows=>[...rows].sort((a,b)=>String(a.travel_date||'').localeCompare(String(b.travel_date||''))||Number(a.sequence||0)-Number(b.sequence||0)||String(a.departure_time||'').localeCompare(String(b.departure_time||'')));
 let state=null,selected=null,choices=[],mode='trains',generation=0;
 const legs=()=>state?.available&&Array.isArray(state.legs)?state.legs:[];
 const ready=()=>state?.configured&&state?.available;
 function table(rows,withBooking=false){
  const heads=withBooking?['Melding','Boeking','Reisdatum','Trein / vervoer','Vertrek','Traject','Aankomst','Reisschema','Controle']:['Melding','Trein / vervoer','Vertrek','Traject','Aankomst','Controle'];
  const timeCell=(r,mode)=>{
   const isArrival=mode==='arrival',old=r[mode+'_time'],oldDate=isArrival?(r.arrival_date||r.travel_date):r.travel_date;
   const next=r.observation?.[mode+'_time'],nextDate=r.observation?.[mode+'_date'];
   const changed=next&&(next!==old||nextDate!==oldDate);
   const showDate=(day)=>day&&day!==r.travel_date?'<span class="arrival-date">'+escape(date(day))+'</span>':'';
   return '<td class="time-cell">'+(changed?'<del aria-label="Tijd uit reisschema">'+escape(old||'Onbekend')+showDate(oldDate)+'</del><strong class="new-time" aria-label="Nieuwe gecontroleerde tijd">'+escape(next)+showDate(nextDate)+'</strong>':'<strong>'+escape(old||'Onbekend')+'</strong>'+showDate(oldDate))+'</td>';
  };
  return '<table class="journey-table"><thead><tr>'+heads.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+sortLegs(rows).map(r=>{
   const c=changeState(r),messages=[];
   if(c.alert)messages.push('<span class="attention" role="img" aria-label="Aandacht nodig" title="'+escape(r.observation.cancelled?'Trein vervalt':r.observation.connection_broken&&!r.observation.backup_communicated?'Aansluiting niet haalbaar; geen back-up gecommuniceerd':'Vertrek minimaal vier minuten vervroegd')+'">!</span>');
   if(c.communicated)messages.push('<span class="communicated" role="img" aria-label="Wijziging gecommuniceerd" title="Gecommuniceerd op '+escape(new Date(r.communication.communicated_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}))+'">✓</span>');
   const source=r.observation?'<span class="source-note">'+escape(r.observation.source)+' · gecontroleerd '+escape(new Date(r.observation.observed_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}))+'</span>':'<span class="source-note">Nog geen gekoppelde controle</span>';
   return '<tr class="'+(c.alert?'needs-attention':'')+'"><td class="status-cell">'+messages.join(' ')+'</td>'+(withBooking?'<td><button class="text-button" data-booking="'+escape(bookingId(r))+'">'+escape(r.dossier)+'</button>'+(r.booking_key?'<br><span class="muted">'+escape(r.booking_key)+'</span>':'')+'</td><td>'+escape(date(r.travel_date))+'</td>':'')+'<td class="train-cell"><strong>'+escape(r.train_number||r.transport_type||'Onbekend')+'</strong>'+(r.role==='backup'?'<span class="badge">Back-up</span>':'')+(r.observation?.cancelled?'<span class="badge">Vervalt</span>':'')+'</td>'+timeCell(r,'departure')+'<td class="route-cell"><span class="station">'+escape(r.from_station)+'</span><span class="route-arrow" aria-label="naar">→</span><span class="station">'+escape(r.to_station)+'</span>'+source+(r.observation?.connection_broken?'<span class="connection-note">Aansluiting niet haalbaar'+(r.observation.backup_communicated?' · back-up gecommuniceerd':'')+'</span>':'')+'</td>'+timeCell(r,'arrival')+(withBooking?'<td>'+documentLink(r.document_url)+'</td>':'')+'<td>'+(r.leg_id?'<button class="small-button" data-edit-leg="'+escape(r.leg_id)+'">Controleren / communicatie</button>':'')+'</td></tr>';
  }).join('')+'</tbody></table>';
 }
 function renderTrains(){
  el('register').innerHTML='';el('summary').textContent='';if(!ready())return;
  const q=normalized(el('search').value),day=el('train-date').value,until=el('train-until').value;
  const rows=legs().filter(r=>trainMatches(r.train_number,el('train-number').value)&&inPeriod(r,day,until)&&(normalized([r.dossier,r.booking_key].join(' ')).includes(q)||routeMatches(r,q)));
  el('summary').textContent=count(rows.length,'rit','ritten')+' · '+count(new Set(rows.map(bookingId)).size,'boeking','boekingen');
  el('register').innerHTML=rows.length?table(rows,true):'<p>Geen ritten gevonden met deze combinatie van filters.</p>';
 }
 function resetBookingFilters(){for(const id of ['booking-date','booking-until','booking-route','booking-train'])el(id).value='';}
 function renderDays(){
  el('booking-days').innerHTML='';el('day-summary').textContent='';if(!ready()||!selected)return;
  const all=legs().filter(r=>bookingId(r)===selected);
  const rows=all.filter(r=>inPeriod(r,el('booking-date').value,el('booking-until').value)&&trainMatches(r.train_number,el('booking-train').value)&&routeMatches(r,el('booking-route').value));
  const groups=new Map();for(const r of sortLegs(rows)){const day=r.travel_date||'';if(!groups.has(day))groups.set(day,[]);groups.get(day).push(r);}
  el('day-summary').textContent=count(rows.length,'rit','ritten')+' op '+count(groups.size,'reisdag','reisdagen');
  el('booking-days').innerHTML=rows.length?[...groups].map(([day,dayLegs])=>'<section class="day"><h3>'+escape(date(day)||'Datum onbekend')+'</h3><div class="scroll">'+table(dayLegs)+'</div></section>').join(''):'<p>Geen ritten gevonden binnen deze boeking. Kies “Alle reisdagen tonen” om de filters te wissen.</p>';
 }
 function showBooking(){
  const rows=legs().filter(r=>bookingId(r)===selected);el('booking-detail').hidden=!rows.length;
  el('booking-header').innerHTML='';if(!rows.length){selected=null;return;}
  const first=rows[0],documents=[...new Set(rows.map(r=>r.document_url).filter(v=>safeLink(v)))];
  // Usually a booking has one current document; preserve distinct links if the source contains several.
  el('booking-header').innerHTML='<div><h2>Boeking '+escape(first.dossier)+'</h2>'+(first.booking_key?'<p>'+escape(first.booking_key)+'</p>':'')+'</div><div class="document-actions">'+(documents.length?documents.map((url,i)=>documentLink(url,documents.length===1?'Reisschema openen':'Reisschema openen ('+(i+1)+')',true)).join(' '):'<p>Geen documentlink beschikbaar voor deze boeking.</p>')+'</div>';
  renderDays();
 }
 function selectBooking(id){selected=id;resetBookingFilters();showBooking();}
 function renderBookings(){
  el('booking-results').innerHTML='';el('booking-detail').hidden=true;el('booking-header').innerHTML='';el('booking-days').innerHTML='';choices=[];
  if(!ready()){el('booking-summary').textContent='';return;}
  const q=dossier(el('booking-number').value);
  if(!q){selected=null;el('booking-summary').textContent='Vul een boekingsnummer in.';return;}
  const groups=new Map();for(const r of legs()){const id=bookingId(r);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
  choices=[...groups].filter(([,rows])=>dossier(rows[0].dossier).includes(q));
  const exact=choices.filter(([,rows])=>dossier(rows[0].dossier)===q);if(exact.length)choices=exact;
  el('booking-summary').textContent=choices.length?count(choices.length,'boeking gevonden','boekingen gevonden')+(choices.length>1?' · Kies de juiste boeking.':''): 'Geen boeking gevonden.';
  if(choices.length===1&&dossier(choices[0][1][0].dossier)===q){selected=choices[0][0];showBooking();return;}
  el('booking-results').innerHTML=choices.map(([id,rows],i)=>{const sorted=sortLegs(rows),dates=[...new Set(sorted.map(r=>r.travel_date))];return '<button class="booking-choice" data-choice="'+i+'"><strong>'+escape(rows[0].dossier)+'</strong><span>'+escape(rows[0].booking_key||'Boeking zonder aanvullende aanduiding')+'</span><span>'+escape(date(dates[0]))+(dates.length>1?' t/m '+escape(date(dates.at(-1))):'')+' · '+count(rows.length,'rit','ritten')+'</span></button>';}).join('');
  if(selected&&choices.some(([id])=>id===selected))showBooking();else selected=null;
 }
 function setMode(next){mode=next;el('trains-panel').hidden=mode!=='trains';el('bookings-panel').hidden=mode!=='bookings';el('mode-trains').setAttribute('aria-pressed',String(mode==='trains'));el('mode-bookings').setAttribute('aria-pressed',String(mode==='bookings'));}
 function render(){renderTrains();renderBookings();}
 async function load(){
  const current=++generation;el('refresh').disabled=true;state=null;render();el('status').textContent='Register laden…';
  try{const r=await fetch('/seinhuis/reisschemas/api/register',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(current!==generation)return;if(!Array.isArray(data.legs))throw Error();state=data;
   el('status').textContent=!data.configured?'De verbinding met het centrale register is nog niet ingesteld.':!data.available?'Reisschemaregister tijdelijk niet bereikbaar. Er worden geen oude gegevens getoond.':'';render();
  }catch{if(current!==generation)return;state=null;render();el('status').textContent='Register niet bereikbaar. Controleer of u bent ingelogd en probeer opnieuw.';}
  finally{if(current===generation)el('refresh').disabled=false;}
 }
 for(const id of ['train-number','train-date','train-until','search'])el(id).oninput=renderTrains;
 for(const id of ['booking-date','booking-until','booking-route','booking-train'])el(id).oninput=renderDays;
 el('booking-number').oninput=()=>{selected=null;resetBookingFilters();renderBookings();};
 el('mode-trains').onclick=()=>setMode('trains');el('mode-bookings').onclick=()=>setMode('bookings');
 el('clear-trains').onclick=()=>{for(const id of ['train-number','train-date','train-until','search'])el(id).value='';renderTrains();};
 el('clear-booking').onclick=()=>{resetBookingFilters();renderDays();};
 el('booking-results').onclick=e=>{const button=e.target.closest('[data-choice]');if(button&&choices[Number(button.dataset.choice)])selectBooking(choices[Number(button.dataset.choice)][0]);};
 el('booking-days').onclick=e=>{const button=e.target.closest('[data-edit-leg]');if(button)openEditor(button.dataset.editLeg);};
 el('register').onclick=e=>{const edit=e.target.closest('[data-edit-leg]');if(edit){openEditor(edit.dataset.editLeg);return;}const button=e.target.closest('[data-booking]');if(!button)return;const row=legs().find(r=>bookingId(r)===button.dataset.booking);if(!row)return;el('booking-number').value=row.dossier;selected=bookingId(row);resetBookingFilters();setMode('bookings');renderBookings();};
 let editing=null;
 function openEditor(id){
  editing=legs().find(r=>r.leg_id===id);if(!editing)return;
  const r=editing,o=r.observation||{};
  el('change-editor').hidden=false;el('editor-leg').textContent=r.dossier+' · '+r.train_number+' · '+r.from_station+' → '+r.to_station;
  el('new-departure-date').value=o.departure_date||r.travel_date;el('new-departure').value=o.departure_time||r.departure_time;
  el('new-arrival-date').value=o.arrival_date||r.arrival_date||r.travel_date;el('new-arrival').value=o.arrival_time||r.arrival_time;
  el('change-source').value=o.source||'';el('change-cancelled').checked=!!o.cancelled;el('change-connection').checked=!!o.connection_broken;el('change-backup').checked=!!o.backup_communicated;
  const now=new Date(),p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  el('communicated-at').value=p.replace(' ','T');el('communication-method').value='email';el('communication-reference').value='';
  el('communication-form').hidden=!changeState(r).changed;
  el('communication-change').textContent=o.departure_time?'Getoonde planning: '+o.departure_time+' – '+o.arrival_time+(o.connection_broken?' · aansluiting niet haalbaar':''):'';
  el('editor-status').textContent='';el('change-editor').scrollIntoView?.({behavior:'smooth',block:'start'});
 }
 async function save(path,data){
  el('save-observation').disabled=true;el('save-communication').disabled=true;el('editor-status').textContent='Opslaan…';
  try{
   const response=await fetch('/seinhuis/reisschemas/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Reisschemas':'1'},body:JSON.stringify(data)});
   if(!response.ok)throw Error();
   const id=editing.leg_id;await load();if(!ready())throw Error();openEditor(id);el('editor-status').textContent='Registratie opgeslagen en opnieuw opgehaald.';
  }catch{el('editor-status').textContent='Opslaan niet bevestigd. Vernieuw en controleer de registratie voordat u opnieuw opslaat.';}
  finally{el('save-observation').disabled=false;el('save-communication').disabled=false;}
 }
 el('observation-form').onsubmit=e=>{
  e.preventDefault();if(!editing)return;
  void save('observation',{versionId:editing.version_id,event:{leg_id:editing.leg_id,request_id:crypto.randomUUID(),departure_date:el('new-departure-date').value,departure_time:el('new-departure').value,arrival_date:el('new-arrival-date').value,arrival_time:el('new-arrival').value,cancelled:el('change-cancelled').checked,connection_broken:el('change-connection').checked,backup_communicated:el('change-backup').checked,source:el('change-source').value,observed_at:new Date().toISOString()}});
 };
 el('communication-form').onsubmit=e=>{
  e.preventDefault();if(!editing?.observation)return;
  void save('communication',{versionId:editing.version_id,legId:editing.leg_id,changeKey:editing.observation.change_key,communicatedAt:new Date(el('communicated-at').value).toISOString(),method:el('communication-method').value,reference:el('communication-reference').value,requestId:crypto.randomUUID()});
 };
 el('close-editor').onclick=()=>{editing=null;el('change-editor').hidden=true;};
 for(const pre of ['train','booking'])for(const [name,offset] of [['today',0],['tomorrow',1],['after',2]])el(pre+'-'+name).onclick=()=>{el(pre+'-date').value=amsterdamDay(offset);el(pre+'-until').value=amsterdamDay(offset);if(pre==='train')renderTrains();else renderDays();};
 el('refresh').onclick=load;setMode(mode);void load();
})();
