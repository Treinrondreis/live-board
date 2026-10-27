const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const delay=t=>t.cancelled?'Uitval':t.delay===null?'onbekend':t.delay>0?`+${t.delay}`:String(t.delay);
const clock=value=>new Date(value).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'});
let currentPage=0,refreshTimer;
const stamp=value=>value?new Date(value).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'geen melding';
function evidenceText(t){
 const e=t.evidence;if(!e)return 'Geen realtimebericht · alleen dienstregeling';
 const kind=e.kind==='cancelled-stop'?'Halte vervallen':e.kind==='reported-departure'?'Vertrek gemeld':'Vertrekverwachting';
 return `${kind} ${e.station} · bron ${stamp(e.timestamp)} · ${e.ageMinutes} minuten oud${e.current?' · recent':' · laatste melding, niet actueel'}`;
}
function render(data){
 currentPage=data.page||0;
 $('count').textContent=`${data.trains.length} van ${data.total} ritten`;
 $('trains').innerHTML=data.trains.length?data.trains.map(t=>`<button class="train" aria-expanded="false"><span class="number">ICE ${escape(t.number)}</span><span class="route" title="${escape(t.routeLabel)}">${escape(t.from)} → ${escape(t.to)}<small class="phase">${escape(t.phaseLabel||'')} · NL verwacht ${clock(t.nlStart?.expected||t.plannedTimestamp)}–${clock(t.nlEnd?.expected||t.plannedTimestamp)}</small></span><span class="delay ${t.delay>0||t.cancelled?'late':''}">${escape(delay(t))}<small>${t.delayKind==='current'?'recente melding':t.delayKind==='historical'?'laatste melding':'geen realtime'}</small></span><span class="evidence">${escape(evidenceText(t))}</span></button><div class="stops" hidden>${escape(t.phaseBasis||'')}<br>${t.nlStart?`Eerste NL-halte ${escape(t.nlStart.station)} · gepland ${stamp(t.nlStart.planned)} · tijd ${stamp(t.nlStart.expected)} · ${escape(t.nlStart.basis||'')}<br>Laatste NL-halte ${escape(t.nlEnd.station)} · ${t.nlEnd.mode==='arrival'?'aankomst':'vertrek'} gepland ${stamp(t.nlEnd.planned)} · tijd ${stamp(t.nlEnd.expected)} · ${escape(t.nlEnd.basis||'')}<br>`:''}${escape(t.position?.label||'')}<br>${escape(t.position?.basis||'')}<br>${t.stops.map(s=>`${escape(s.station)} · ${s.mode==='arrival'?'aankomst':'vertrek'} gepland ${clock(s.plannedTimestamp)}`).join('<br>')}</div>`).join(''):'<p>Geen ICE-ritten binnen het geselecteerde Nederlandse tijdvenster.</p>';
 document.querySelectorAll('.train').forEach(b=>b.onclick=()=>{const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));b.nextElementSibling.hidden=!open;});
 updateMarkers(data.trains);
 $('status').textContent=`NDOV-bron ${data.feedFresh?'ontvangt berichten':'niet actueel'} · laatste bronbericht ${stamp(data.lastMessageAt)} · pagina geladen ${clock(data.generatedAt)}${data.coverage==='partial-observations'?' · volledige dienstregeling ontbreekt; dekking onvolledig':''}`;
 $('previous').disabled=currentPage===0;$('next').disabled=currentPage+1>=data.pages;
 $('pagination').hidden=data.pages<=1;
 $('page-label').textContent=`Pagina ${currentPage+1} van ${data.pages||1}`;
}
async function refresh(){clearTimeout(refreshTimer);try{const r=await fetch(`/api/ice-radar?page=${currentPage}`,{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!r.ok)throw Error();render(await r.json());}catch{$('trains').replaceChildren();markerLayer?.clearLayers();$('count').textContent='Niet beschikbaar';$('status').textContent='Geen actuele gegevens bereikbaar. Er wordt automatisch opnieuw geprobeerd.';}finally{refreshTimer=setTimeout(refresh,30000);}}
$('previous').onclick=()=>{currentPage=Math.max(0,currentPage-1);refresh();};
$('next').onclick=()=>{currentPage++;refresh();};
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
 $('position-status').textContent=trains.some(t=>t.position?.kind==='estimated')?'Stippen tonen geschatte posities; wijs een stip aan voor trein en vertraging.':'Geen betrouwbare voertuigpositie beschikbaar voor deze ritten. Bekijk de laatste bronmeldingen in de lijst.';
 if(!markerLayer)return;
 markerLayer.clearLayers();
 const groups=new Map();
 for(const t of trains){const p=t.position;if(p?.kind!=='estimated'||!p.coordinates)continue;const key=p.coordinates.join(',');const g=groups.get(key)||[];g.push(t);groups.set(key,g);}
 for(const group of groups.values()){
  const p=group[0].position,[lon,lat]=p.coordinates,estimated=p.kind==='estimated';
  const label=group.map(t=>`ICE ${escape(t.number)} · ${escape(delay(t))}`).join('<br>');
  const popup=group.map(t=>`<strong>ICE ${escape(t.number)}</strong><br>${escape(t.position.label)}<br>${escape(t.position.basis)}<br>Vertraging ${escape(delay(t))} · vertrek ${escape(t.station)}<br>Positiebasis ${stamp(t.position.messageAt)}<br>${escape(evidenceText(t))}`).join('<hr>');
  L.marker([lat,lon],{icon:L.divIcon({className:`ice-marker ${estimated?'estimated':'station-report'}`,html:'',iconSize:[14,14],iconAnchor:[7,7]}),title:p.label,keyboard:true}).addTo(markerLayer).bindTooltip(label,{direction:'top'}).bindPopup(popup);
 }
}
setInterval(()=>$('clock').textContent=clock(Date.now()),1000);refresh();
