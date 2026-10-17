(()=>{
 const el=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),date=s=>String(s||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
 let state;
 const link=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password?'<a target="_blank" rel="noopener noreferrer" href="'+escape(u.href)+'">Reisschema openen</a>':'Geen documentlink';}catch{return 'Geen documentlink';}};
 function render(){
  el('register').innerHTML='';
  if(!state?.configured){el('summary').textContent='De verbinding met het centrale register is nog niet ingesteld.';return;}
  if(!state.available){el('summary').textContent='Reisschemaregister tijdelijk niet bereikbaar. Er worden geen oude gegevens getoond.';return;}
  const q=el('search').value.toLowerCase(),legs=state.legs.filter(r=>[r.dossier,r.booking_key,r.train_number,r.from_station,r.to_station,r.travel_date,date(r.travel_date)].join(' ').toLowerCase().includes(q));
  el('summary').textContent=legs.length+' ritten · '+new Set(legs.map(r=>JSON.stringify([r.dossier,r.booking_key]))).size+' boekingen';
  el('register').innerHTML='<table><thead><tr>'+['Boeking','Reisdatum','Trein / vervoer','Van → naar','Vertrek / aankomst','Hoofdrit of back-up','Document'].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+legs.map(r=>'<tr><td>'+escape(r.dossier)+(r.booking_key?'<br>'+escape(r.booking_key):'')+'</td><td>'+escape(date(r.travel_date))+'</td><td>'+escape(r.train_number||r.transport_type)+'</td><td>'+escape(r.from_station)+' → '+escape(r.to_station)+'</td><td>'+escape(r.departure_time||'Onbekend')+' / '+escape(r.arrival_time||'Onbekend')+(r.arrival_date&&r.arrival_date!==r.travel_date?'<br>'+escape(date(r.arrival_date)):'')+'</td><td>'+(r.role==='backup'?'Back-up':'Hoofdrit')+'</td><td>'+link(r.document_url)+'</td></tr>').join('')+'</tbody></table>';
 }
 async function load(){
  el('refresh').disabled=true;state=null;el('register').innerHTML='';el('summary').textContent='Register laden…';
  try{const r=await fetch('/seinhuis/reisschemas/api/register',{cache:'no-store'});if(!r.ok)throw Error();state=await r.json();render();}
  catch{state=null;el('register').innerHTML='';el('summary').textContent='Register niet bereikbaar. Controleer of u bent ingelogd en probeer opnieuw.';}
  finally{el('refresh').disabled=false;}
 }
 el('search').oninput=render;el('refresh').onclick=load;void load();
})();
