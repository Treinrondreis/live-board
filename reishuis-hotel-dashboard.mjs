import {hotelStays,hotelResolver} from './reishuis-hotel-links.mjs';
import {mergeDossier} from './reishuis-dossier.mjs';
export function unlinkedHotels(bookings,state,hotels){const resolve=hotelResolver(hotels),rows=[];for(const b of bookings){const d=mergeDossier({todos:b.hotelTodos||[],lines:[],personal:{}},state.dossiers?.[b.id]);for(const t of d.todos){if(t.tag!=='hotel'||t.review||t.archived||t.sourceRemoved||t.component?.hotel||t.hotelLink||resolve(t.title).length===1)continue;rows.push({booking:b.id,index:b.index,name:b.name,todo:t.id,title:t.title,checkin:t.startDate,checkout:t.endDate,status:t.status});}}return rows.sort((a,b)=>String(a.checkin||'9999').localeCompare(String(b.checkin||'9999'))||a.index.localeCompare(b.index));}
export function hotelDashboard(bookings,state,hotels,today,period='upcoming'){
 // One matching/pricing pass per period; rankings reuse its booked rows.
 const upcoming=hotelStays(bookings,state,hotels,null,today,'upcoming',-1,{includePending:true}).stays;
 const selected=period==='upcoming'?upcoming:hotelStays(bookings,state,hotels,null,today,'past',-1,{includePending:true}).stays;
 const all=period==='all'?[...selected,...upcoming]:selected,counts=new Map();for(const s of all)if(s.booked&&s.checkin&&s.checkout&&s.checkout>s.checkin)counts.set(s.hotel,(counts.get(s.hotel)||0)+1);
 const departures=new Map(bookings.map(b=>[b.id,b.departure])),groups=new Map();
 // Savings only from future trips, including when viewing earlier hotel stays.
 for(const row of upcoming){if(!(departures.get(row.booking)>=today)||row.checkin<today||row.cancelled)continue;if(!groups.has(row.booking))groups.set(row.booking,[]);groups.get(row.booking).push(row);}
 const savings=[...groups.values()].filter(rows=>rows.every(r=>Number.isFinite(r.saving))).map(rows=>({...rows[0],checkin:rows.map(r=>r.checkin).sort()[0],checkout:rows.map(r=>r.checkout).sort().at(-1),place:[...new Set(rows.map(r=>r.place))].join(' / '),saving:Math.round(rows.reduce((n,r)=>n+r.saving,0)*100)/100})).filter(r=>r.saving>0).sort((a,b)=>b.saving-a.saving).slice(0,5);
 return {hotels:hotels.map(h=>({id:h.id,title:h.title,titleShort:h.titleShort,country:h.country||'',photoCount:h.photos.length,booked:counts.get(h.id)||0})).sort((a,b)=>b.booked-a.booked||a.title.localeCompare(b.title)),savings,unlinked:unlinkedHotels(bookings,state,hotels)};
}
