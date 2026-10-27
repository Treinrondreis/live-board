const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const delay=t=>t.cancelled?'Uitval':t.delay===null?'?':t.delay>0?`+${t.delay}`:String(t.delay);
const clock=value=>new Date(value).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'});
function render(data){
 $('count').textContent=`${data.trains.length} van ${data.total} ritten`;
 $('trains').innerHTML=data.trains.length?data.trains.map(t=>`<button class="train" aria-expanded="false" aria-label="ICE ${escape(t.number)}, ${escape(t.from)} naar ${escape(t.to)}, ${escape(t.station)}"><span class="number">ICE ${escape(t.number)}</span><span class="route" title="${escape(t.routeLabel)}">${escape(t.from)} → ${escape(t.to)}</span><span class="delay ${t.delay>0||t.cancelled?'late':''}">${escape(delay(t))}</span><span class="station">vertrek ${escape(t.station)}${t.stale?' · oud':''}</span></button><div class="stops" hidden>${t.stops.map(s=>`${escape(s.station)} · ${clock(s.plannedTimestamp)} · ${escape(delay(s))}${s.departed?' · vertrokken':''}`).join('<br>')}</div>`).join(''):'<p>Geen ICE-ritten beschikbaar in de aangesloten stationsmeldingen.</p>';
 document.querySelectorAll('.train').forEach(b=>b.onclick=()=>{const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));b.nextElementSibling.hidden=!open;});
 updateMarkers(data.trains);
 $('status').textContent=`Bijgewerkt ${clock(data.generatedAt)} · NDOV vertrekverwachtingen · ? = onbekend`;
}
async function refresh(){try{const r=await fetch('/api/ice-radar',{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!r.ok)throw Error();render(await r.json());}catch{$('trains').replaceChildren();markerLayer?.clearLayers();$('count').textContent='Niet beschikbaar';$('status').textContent='Geen actuele gegevens bereikbaar. Er wordt automatisch opnieuw geprobeerd.';}finally{setTimeout(refresh,30000);}}
let map=null,markerLayer=null;
try{
 if(!window.L)throw Error('Kaartbibliotheek ontbreekt');
 map=L.map('map',{scrollWheelZoom:false}).setView([52.05,5.45],7);
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:16,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 tiles.on('tileerror',()=>{$('map-status').textContent='Kaartachtergrond niet bereikbaar. Treinmeldingen blijven beschikbaar.';});
 tiles.on('load',()=>{$('map-status').textContent='';});
 markerLayer=L.layerGroup().addTo(map);
}catch{$('map-status').textContent='De kaart is niet beschikbaar. De rittenlijst blijft bruikbaar.';}
function updateMarkers(trains){
 if(!markerLayer)return;
 markerLayer.clearLayers();
 const groups=new Map();
 for(const t of trains){const p=t.position;if(!p?.coordinates)continue;const key=p.coordinates.join(',');const g=groups.get(key)||[];g.push(t);groups.set(key,g);}
 for(const group of groups.values()){
  const p=group[0].position,[lon,lat]=p.coordinates,estimated=p.kind==='estimated';
  const label=group.map(t=>`ICE ${escape(t.number)} <b>${escape(delay(t))}</b>`).join('<br>');
  const popup=group.map(t=>`<strong>ICE ${escape(t.number)}</strong><br>${escape(t.position.label)}<br>${escape(t.position.basis)}<br>Vertraging ${escape(delay(t))} · vertrek ${escape(t.station)}<br>Bronmelding ${clock(t.messageAt)}`).join('<hr>');
  L.marker([lat,lon],{icon:L.divIcon({className:`ice-marker ${estimated?'estimated':'station-report'}`,html:label,iconSize:null,iconAnchor:[12,12]}),title:p.label,keyboard:true}).addTo(markerLayer).bindPopup(popup);
 }
}
setInterval(()=>$('clock').textContent=clock(Date.now()),1000);refresh();
