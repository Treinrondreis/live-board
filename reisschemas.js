(()=>{
 const el=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=s=>String(s||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
 const normalized=s=>String(s??'').normalize('NFKC').trim().toLowerCase();
 const dossier=s=>normalized(s).replace(/\s/g,'').replace(/-?a$/,'');
 const bookingId=r=>JSON.stringify([r.dossier,r.booking_key||'']);
 const count=(n,one,many)=>n+' '+(n===1?one:many);
 function trainMatches(value,query){
  const q=normalized(query).replace(/\s/g,''),v=normalized(value).replace(/\s/g,'');
  if(!q)return true;
  return q===v||(/^\d+[a-z]?$/.test(q)&&v.match(/\d+[a-z]?$/)?.[0]===q);
 }
 function routeMatches(r,query){
  const q=normalized(query).replace(/\s*(?:→|->|–|—| - )\s*/g,' ');
  return q.split(/\s+/).filter(Boolean).every(word=>normalized(r.from_station+' '+r.to_station).includes(word));
 }
 const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 const documentLink=(value,label='Reisschema openen',primary=false)=>{const url=safeLink(value);return url?'<a class="'+(primary?'document-button':'')+'" target="_blank" rel="noopener noreferrer" href="'+escape(url)+'">'+escape(label)+' ↗</a>':'<span class="muted">Geen documentlink beschikbaar</span>';};
 const sortLegs=rows=>[...rows].sort((a,b)=>String(a.travel_date||'').localeCompare(String(b.travel_date||''))||Number(a.sequence||0)-Number(b.sequence||0)||String(a.departure_time||'').localeCompare(String(b.departure_time||'')));
 let state=null,selected=null,choices=[],mode='trains',generation=0;
 const legs=()=>state?.available&&Array.isArray(state.legs)?state.legs:[];
 const ready=()=>state?.configured&&state?.available;
 function table(rows,withBooking=false){
  const heads=withBooking?['Boeking','Reisdatum','Trein / vervoer','Vertrek','Traject','Aankomst','Reisschema']:['Trein / vervoer','Vertrek','Traject','Aankomst'];
  const timeCell=(value,arrivalDate)=>'<td class="time-cell"><strong>'+escape(value||'Onbekend')+'</strong>'+(arrivalDate?'<span class="arrival-date">'+escape(date(arrivalDate))+'</span>':'')+'</td>';
  return '<table class="journey-table"><thead><tr>'+heads.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+sortLegs(rows).map(r=>'<tr>'+(withBooking?'<td><button class="text-button" data-booking="'+escape(bookingId(r))+'">'+escape(r.dossier)+'</button>'+(r.booking_key?'<br><span class="muted">'+escape(r.booking_key)+'</span>':'')+'</td><td>'+escape(date(r.travel_date))+'</td>':'')+'<td class="train-cell"><strong>'+escape(r.train_number||r.transport_type||'Onbekend')+'</strong>'+(r.role==='backup'?'<span class="badge">Back-up</span>':'')+'</td>'+timeCell(r.departure_time)+'<td class="route-cell"><span class="station">'+escape(r.from_station)+'</span><span class="route-arrow" aria-label="naar">→</span><span class="station">'+escape(r.to_station)+'</span></td>'+timeCell(r.arrival_time,r.arrival_date&&r.arrival_date!==r.travel_date?r.arrival_date:null)+(withBooking?'<td>'+documentLink(r.document_url)+'</td>':'')+'</tr>').join('')+'</tbody></table>';
 }
 function renderTrains(){
  el('register').innerHTML='';el('summary').textContent='';if(!ready())return;
  const q=normalized(el('search').value),day=el('train-date').value;
  const rows=legs().filter(r=>trainMatches(r.train_number,el('train-number').value)&&(!day||r.travel_date===day)&&normalized([r.dossier,r.booking_key,r.from_station,r.to_station].join(' ')).includes(q));
  el('summary').textContent=count(rows.length,'rit','ritten')+' · '+count(new Set(rows.map(bookingId)).size,'boeking','boekingen');
  el('register').innerHTML=rows.length?table(rows,true):'<p>Geen ritten gevonden met deze combinatie van filters.</p>';
 }
 function resetBookingFilters(){for(const id of ['booking-date','booking-route','booking-train'])el(id).value='';}
 function renderDays(){
  el('booking-days').innerHTML='';el('day-summary').textContent='';if(!ready()||!selected)return;
  const all=legs().filter(r=>bookingId(r)===selected);
  const rows=all.filter(r=>(!el('booking-date').value||r.travel_date===el('booking-date').value)&&trainMatches(r.train_number,el('booking-train').value)&&routeMatches(r,el('booking-route').value));
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
 for(const id of ['train-number','train-date','search'])el(id).oninput=renderTrains;
 for(const id of ['booking-date','booking-route','booking-train'])el(id).oninput=renderDays;
 el('booking-number').oninput=()=>{selected=null;resetBookingFilters();renderBookings();};
 el('mode-trains').onclick=()=>setMode('trains');el('mode-bookings').onclick=()=>setMode('bookings');
 el('clear-trains').onclick=()=>{for(const id of ['train-number','train-date','search'])el(id).value='';renderTrains();};
 el('clear-booking').onclick=()=>{resetBookingFilters();renderDays();};
 el('booking-results').onclick=e=>{const button=e.target.closest('[data-choice]');if(button&&choices[Number(button.dataset.choice)])selectBooking(choices[Number(button.dataset.choice)][0]);};
 el('register').onclick=e=>{const button=e.target.closest('[data-booking]');if(!button)return;const row=legs().find(r=>bookingId(r)===button.dataset.booking);if(!row)return;el('booking-number').value=row.dossier;selected=bookingId(row);resetBookingFilters();setMode('bookings');renderBookings();};
 el('refresh').onclick=load;setMode(mode);void load();
})();


