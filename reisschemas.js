import {journeyTable} from './reisschema-table.mjs';
import {numberAssessment,controlPolicy,manualControlAttention} from './reisschema-number-policy.mjs';
import {punctualityView} from './punctuality-view.mjs';
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
  const changed=o.departure_time!==r.departure_time||o.departure_date!==r.travel_date||o.arrival_time!==r.arrival_time||o.arrival_date!==(r.arrival_date||r.travel_date)||o.cancelled||o.connection_broken||o.station_changed||numberAssessment(r,o).notify;
  const earlier=minute(r.travel_date,r.departure_time)-minute(o.departure_date,o.departure_time);
  return {changed,earlier,alert:earlier>=4||o.cancelled||o.station_changed||(o.connection_broken&&!o.backup_communicated),communicated:changed&&r.communication?.change_key===o.change_key};
 }
 const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 const documentLink=(value,label='Reisschema openen',primary=false)=>{const url=safeLink(value);return url?'<a class="'+(primary?'document-button':'')+'" target="_blank" rel="noopener noreferrer" href="'+escape(url)+'">'+escape(label)+' ↗</a>':'<span class="muted">Geen documentlink beschikbaar</span>';};
 const sortLegs=rows=>[...rows].sort((a,b)=>String(a.travel_date||'').localeCompare(String(b.travel_date||''))||Number(a.sequence||0)-Number(b.sequence||0)||String(a.departure_time||'').localeCompare(String(b.departure_time||'')));
 let state=null,selected=null,choices=[],mode='trains',generation=0,controlFilter='all';
 const checkedLegs=new Set();
 const legs=()=>state?.available&&Array.isArray(state.legs)?state.legs:[];
 const notificationRows=()=>state?.available&&Array.isArray(state.notifications)?state.notifications:[];
 const ready=()=>state?.configured&&state?.available;
 const table=(rows,withBooking=false)=>journeyTable(rows,withBooking,{checkedLegs});
 function renderTrains(){
  el('register').innerHTML='';el('summary').textContent='';if(!ready())return;
  const q=normalized(el('search').value),day=el('train-date').value,until=el('train-until').value;
  const rows=legs().filter(r=>{const policy=controlPolicy(r),n=numberAssessment(r,r.observation);return (controlFilter==='all'||controlFilter==='manual'&&(manualControlAttention(r)||policy.extra_db_required)||controlFilter==='numbers'&&n.changed||controlFilter==='notices'&&(n.changed||policy.extra_db_required||manualControlAttention(r)||changeState(r).changed||r.control?.assessment?.tightConnectionReview)||controlFilter==='changes'&&changeState(r).changed&&!changeState(r).communicated)&&(trainMatches(r.train_number,el('train-number').value)||!!r.observation?.train_number&&trainMatches(r.observation.train_number,el('train-number').value))&&inPeriod(r,day,until)&&(normalized([r.dossier,r.booking_key,r.control?.reason].join(' ')).includes(q)||routeMatches(r,q));});
  el('summary').textContent=count(rows.length,'rit','ritten')+' · '+count(new Set(rows.map(bookingId)).size,'boeking','boekingen');
  el('register').innerHTML=rows.length?table(rows,true):'<p>Geen ritten gevonden met deze combinatie van filters.</p>';
 }
 function resetBookingFilters(){for(const id of ['booking-date','booking-until','booking-route','booking-train'])el(id).value='';}
 function renderDays(){
  el('booking-days').innerHTML='';el('day-summary').textContent='';if(!ready()||!selected)return;
  const all=legs().filter(r=>bookingId(r)===selected);
  const rows=all.filter(r=>inPeriod(r,el('booking-date').value,el('booking-until').value)&&(trainMatches(r.train_number,el('booking-train').value)||!!r.observation?.train_number&&trainMatches(r.observation.train_number,el('booking-train').value))&&routeMatches(r,el('booking-route').value));
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
 function render(){renderTrains();renderBookings();const rows=notificationRows();el('notification-panel').hidden=!rows.length;el('notification-rows').innerHTML=rows.length?table(rows,true):'';}
 async function load(){
  const current=++generation;el('refresh').disabled=true;state=null;render();el('status').textContent='Register laden…';
  try{const r=await fetch('/seinhuis/reisschemas/api/register',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(current!==generation)return;if(!Array.isArray(data.legs))throw Error();state=data;for(const id of checkedLegs)if(!data.legs.some(r=>r.leg_id===id&&r.status==='active'))checkedLegs.delete(id);updateSelection();
   el('status').textContent=!data.configured?'De verbinding met het centrale register is nog niet ingesteld.':!data.available?'Reisschemaregister tijdelijk niet bereikbaar. Er worden geen oude gegevens getoond.':'';
   const p=data.punctualityStatus;el('punctuality-status').textContent=p?.ready?'Stiptheid: blijvend bewaren ingeschakeld. '+(p.error||p.backfill?.error||'')+(p.backfill?.running?' Bestaande bordmetingen worden overgenomen.':''):'';render();
  }catch{if(current!==generation)return;state=null;render();el('status').textContent='Register niet bereikbaar. Controleer of u bent ingelogd en probeer opnieuw.';}
  finally{if(current===generation)el('refresh').disabled=false;}
 }
 for(const id of ['train-number','train-date','train-until','search'])el(id).oninput=renderTrains;
 for(const id of ['booking-date','booking-until','booking-route','booking-train'])el(id).oninput=renderDays;
 el('booking-number').oninput=()=>{selected=null;resetBookingFilters();renderBookings();};
 el('mode-trains').onclick=()=>setMode('trains');el('mode-bookings').onclick=()=>setMode('bookings');
 const controlFilters=['manual','changes','notices','numbers','all'];
 const markFilter=()=>{for(const filter of controlFilters)el('filter-'+filter).setAttribute('aria-pressed',String(controlFilter===filter));};
 for(const filter of controlFilters)el('filter-'+filter).onclick=()=>{controlFilter=filter;markFilter();renderTrains();};
 markFilter();
 el('clear-trains').onclick=()=>{for(const id of ['train-number','train-date','train-until','search'])el(id).value='';renderTrains();};
 el('clear-booking').onclick=()=>{resetBookingFilters();renderDays();};
 el('booking-results').onclick=e=>{const button=e.target.closest('[data-choice]');if(button&&choices[Number(button.dataset.choice)])selectBooking(choices[Number(button.dataset.choice)][0]);};
 el('booking-days').onclick=e=>{const history=e.target.closest('[data-punctuality]');if(history){void showPunctuality(history.dataset.punctuality);return;}const button=e.target.closest('[data-edit-leg]');if(button)openEditor(button.dataset.editLeg);};
 el('register').onclick=e=>{const history=e.target.closest('[data-punctuality]');if(history){void showPunctuality(history.dataset.punctuality);return;}const edit=e.target.closest('[data-edit-leg]');if(edit){openEditor(edit.dataset.editLeg);return;}const button=e.target.closest('[data-booking]');if(!button)return;const row=legs().find(r=>bookingId(r)===button.dataset.booking);if(!row)return;el('booking-number').value=row.dossier;selected=bookingId(row);resetBookingFilters();setMode('bookings');renderBookings();};
 async function showPunctuality(id){
  const panel=el('punctuality-history');panel.hidden=false;panel.innerHTML='<h2>Stiptheidshistorie</h2><p>Laden…</p>';
  try{const response=await fetch('/seinhuis/reisschemas/api/punctuality?legId='+encodeURIComponent(id),{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();
   const clock=t=>t?new Date(t).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}):'—';
   panel.innerHTML='<h2>Stiptheidshistorie</h2><p>Blijvend bewaarde gewijzigde metingen. Verwachtingen zijn geen bevestigde werkelijke tijden. Maximaal de laatste 500 metingen worden hier getoond.</p><div class="scroll"><table><thead><tr><th>Vertrek / aankomst</th><th>Gepland</th><th>Verwacht</th><th>Werkelijk</th><th>Vertraging</th><th>Bron / gemeten</th></tr></thead><tbody>'+data.measurements.map(m=>'<tr><td>'+escape(m.event_mode==='arrival'?'Aankomst':'Vertrek')+'<br>'+escape(m.station)+'</td><td>'+escape(clock(m.planned_at))+'</td><td>'+escape(clock(m.expected_at))+'</td><td>'+escape(clock(m.actual_at))+'</td><td class="'+(m.delay_minutes>0?'delay-minutes':'')+'">'+escape(m.cancelled?'Uitval gemeld':m.delay_minutes==null?'Onbekend':(m.delay_minutes>0?'+':'')+m.delay_minutes)+'</td><td>'+escape(m.source)+'<br>'+escape(clock(m.last_seen_at))+'</td></tr>').join('')+'</tbody></table></div>';
  }catch{panel.innerHTML='<h2>Stiptheidshistorie</h2><p>Metingen niet bereikbaar.</p>';}
  panel.scrollIntoView?.({behavior:'smooth',block:'start'});
 }
 let editing=null;
 function openEditor(id){
  editing=[...legs(),...notificationRows()].find(r=>r.leg_id===id);if(!editing)return;
  const r=editing,o=r.observation||{};
  el('observation-form').hidden=!!r.notification_context;
  el('change-editor').hidden=false;el('editor-leg').textContent=r.dossier+' · '+r.train_number+' · '+r.from_station+' → '+r.to_station;
  el('new-departure-date').value=o.departure_date||r.travel_date;el('new-departure').value=o.departure_time||r.departure_time;
  el('new-arrival-date').value=o.arrival_date||r.arrival_date||r.travel_date;el('new-arrival').value=o.arrival_time||r.arrival_time;
  el('change-source').value=o.source||'';el('change-cancelled').checked=!!o.cancelled;el('change-connection').checked=!!o.connection_broken;el('change-backup').checked=!!o.backup_communicated;
  el('new-from-station').value=o.departure_station||r.from_station;el('new-to-station').value=o.arrival_station||r.to_station;
  el('new-train-number').value=o.train_number||r.train_number;el('reservation-status').value=o.reservation_status||'auto';el('db-verified').checked=false;
  const now=new Date(),p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  el('communicated-at').value=p.replace(' ','T');el('communication-method').value='email';el('communication-reference').value='';
  el('communication-form').hidden=!changeState(r).changed;
  el('draft-form').hidden=!changeState(r).changed||!r.observation_revision;
  el('draft-to').value='';el('draft-destination').value='';el('draft-advice').value='';
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
  void save('observation',{versionId:editing.version_id,event:{leg_id:editing.leg_id,request_id:crypto.randomUUID(),departure_date:el('new-departure-date').value,departure_time:el('new-departure').value,arrival_date:el('new-arrival-date').value,arrival_time:el('new-arrival').value,cancelled:el('change-cancelled').checked,connection_broken:el('change-connection').checked,backup_communicated:el('change-backup').checked,departure_station:el('new-from-station').value,arrival_station:el('new-to-station').value,station_changed:el('new-from-station').value!==editing.from_station||el('new-to-station').value!==editing.to_station,train_number:el('new-train-number').value,reservation_status:el('reservation-status').value,db_verified:el('db-verified').checked,source:el('db-verified').checked?'DB handmatig':el('change-source').value,observed_at:new Date().toISOString()}});
 };
 el('communication-form').onsubmit=e=>{
  e.preventDefault();if(!editing?.observation)return;
  void save('communication',{versionId:editing.version_id,legId:editing.leg_id,changeKey:editing.observation.change_key,communicatedAt:new Date(el('communicated-at').value).toISOString(),method:el('communication-method').value,reference:el('communication-reference').value,requestId:crypto.randomUUID()});
 };
 el('close-editor').onclick=()=>{editing=null;el('change-editor').hidden=true;};
 el('notification-rows').onclick=e=>{const button=e.target.closest('[data-edit-leg]');if(button)openEditor(button.dataset.editLeg);};
 for(const pre of ['train','booking'])for(const [name,offset] of [['today',0],['tomorrow',1],['after',2]])el(pre+'-'+name).onclick=()=>{el(pre+'-date').value=amsterdamDay(offset);el(pre+'-until').value=amsterdamDay(offset);if(pre==='train')renderTrains();else renderDays();};
 async function controlAction(path,data){const response=await fetch('/seinhuis/reisschemas/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Reisschemas':'1'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.reason||result.error||'Actie niet bevestigd');return result;}

 function updateSelection(){el('run-selected').disabled=!checkedLegs.size;el('run-selected').textContent='Geselecteerde ritten controleren ('+checkedLegs.size+')';}
 for(const id of ['register','booking-days'])el(id).onchange=e=>{const box=e.target.closest('[data-select-leg]');if(!box)return;if(box.checked&&checkedLegs.size>=100){box.checked=false;el('selection-status').textContent='Selecteer maximaal 100 ritregels per controle.';return;}if(box.checked)checkedLegs.add(box.dataset.selectLeg);else checkedLegs.delete(box.dataset.selectLeg);updateSelection();};
 el('clear-selected').onclick=()=>{checkedLegs.clear();updateSelection();renderTrains();renderDays();};
 el('run-selected').onclick=async()=>{const button=el('run-selected');button.disabled=true;try{const result=await controlAction('run-controls',{legIds:[...checkedLegs]});if(!result.accepted)throw Error(result.reason||'Controle niet gestart');checkedLegs.clear();renderTrains();renderDays();el('selection-status').textContent='Controle aangevraagd voor '+result.count+' ritregels. Vernieuw later voor de resultaten.';await loadControls();}catch(e){el('selection-status').textContent=e.message;}finally{updateSelection();}};
 let controlState;
 async function loadControls(){try{const r=await fetch('/seinhuis/reisschemas/api/controls',{cache:'no-store'});if(!r.ok)throw Error();controlState=await r.json();el('controls-status').textContent=(controlState.enabled?'Dagelijkse controles ingeschakeld. ':'Dagelijkse controles uitgeschakeld. ')+'Planning: dagelijks 00:30 uur Nederlandse tijd. '+(controlState.running?'Controle loopt. ':'')+(controlState.lastRun?'Laatste ronde: '+new Date(controlState.lastRun).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'})+'. ':'')+(controlState.error||'')+' Gmail-concepten: '+(controlState.gmail.connected?'gekoppeld.':'nog niet gekoppeld.');const report=controlState.summary;el('control-source-status').textContent=report?report.selected+' geselecteerd; '+report.checked+' volledig gecontroleerd; '+report.manual+' aandachtspunten; '+(report.unchecked||0)+' niet gecontroleerd; '+(report.extraDb||0)+' aanvullende DB-controles; '+(report.numberNotices||0)+' nummermeldingen; '+report.pending+' nog te bewaren. '+(report.sources||[]).map(s=>s.name+': '+(s.status==='ready'?'beschikbaar ('+s.matched+' passende ritregels)':s.status==='not_needed'?'niet nodig (geen relevante of nog ongedekte ritten)':'niet bruikbaar')).join(' · '):'';el('toggle-controls').textContent=controlState.enabled?'Dagelijkse controles uitschakelen':'Dagelijkse controles inschakelen';}catch{el('controls-status').textContent='Controlestatus niet bereikbaar.';}}
 for(const id of ['toggle-controls','run-controls','connect-drafts'])el(id).onclick=async()=>{const button=el(id);button.disabled=true;try{const path=id==='toggle-controls'?'controls':id==='run-controls'?'run-controls':'google-start',data=id==='toggle-controls'?{enabled:!controlState?.enabled}:{};const result=await controlAction(path,data);if(result.url){const u=new URL(result.url);if(u.origin!=='https://accounts.google.com')throw Error('Ongeldige Google-link');location.assign(u.href);return;}el('control-action-status').textContent=id==='run-controls'?'Controle aangevraagd. Vernieuw later voor de resultaten.':'Instelling opgeslagen.';await loadControls();}catch(e){el('control-action-status').textContent=e.message;}finally{button.disabled=false;}};
 el('draft-form').onsubmit=async e=>{e.preventDefault();if(!editing?.observation_revision)return;el('create-draft').disabled=true;try{const result=await controlAction('draft',{legId:editing.leg_id,changeKey:editing.observation.change_key,observationRevision:editing.observation_revision,to:el('draft-to').value,destination:el('draft-destination').value,advice:el('draft-advice').value});el('editor-status').textContent=result.existing?'Er bestaat al een concept voor deze wijziging. Controleer Gmail.':'Concept in Gmail aangemaakt. Controleer en verstuur het daar; registreer daarna de communicatie.';}catch(e){el('editor-status').textContent=e.message;}finally{el('create-draft').disabled=false;}};
 el('refresh').onclick=async()=>{await Promise.all([load(),loadControls()]);};setMode(mode);void load();void loadControls();
})();
