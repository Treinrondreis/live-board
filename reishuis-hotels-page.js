import {createHotelLanding} from './reishuis-hotel-landing.js';
import {installReishuisShell} from './reishuis-shell.js';
installReishuisShell(new URL(location.href).searchParams.get('view')==='unlinked'?'unlinked':'hotels');
import {createHotelsUI} from './reishuis-hotels-ui.js';
const base='/seinhuis/reishuis',node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const params=()=>new URL(location.href).searchParams,identity=v=>typeof v==='string'&&/^[-a-zA-Z0-9_.]{1,160}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v),backBooking=params().get('returnBooking');let rendering=false,renderSeq=0;
const update=(id,tab,search=history.state?.hotelSearch||'')=>{const u=new URL(location.href);if(id){u.searchParams.set('id',id);u.searchParams.delete('view');}else u.searchParams.delete('id');if(tab)u.searchParams.set('tab',tab);else u.searchParams.delete('tab');if(u.href!==location.href){history.replaceState({hotelSearch:search},'',location.href);history.pushState({hotelSearch:search},'',u);}};
const ui=createHotelsUI({node,base,onDenied:()=>{ui.clear();document.getElementById('hotel-error').hidden=false;},onClose:()=>location.assign(base+'/boekingen/'+(identity(backBooking)?'?'+new URLSearchParams({id:backBooking}):'')),onSelect:update,onList:()=>{update(null);void landing.render(document.querySelector('.hotel-main')).catch(()=>{const body=document.querySelector('.hotel-main');if(body&&document.querySelector('.hotel-dialog[open]'))body.replaceChildren(node('p','Hoteloverzicht tijdelijk niet beschikbaar.'));});}});
const landing=createHotelLanding({node,base,ui,onDenied:()=>ui.clear()});
const render=async()=>{const seq=++renderSeq;rendering=true;try{const p=params(),id=p.get('id');const ready=landing.preload();if(identity(id))await ui.openHotel(id,{tab:p.get('tab'),search:(history.state?.hotelSearch||p.get('q')||'').slice(0,160)});else await ui.open({search:(history.state?.hotelSearch||p.get('q')||'').slice(0,160)});await ready;if(seq!==renderSeq)return;if(identity(params().get('id')))await landing.prepare();else await landing.render(document.querySelector('.hotel-main'),p.get('view'));}catch{const body=document.querySelector('.hotel-main');if(body)body.replaceChildren(node('p','Hoteloverzicht tijdelijk niet beschikbaar. Vernieuw om opnieuw te proberen.'));}finally{rendering=false;}};
window.addEventListener('popstate',()=>void render());void render();

const checkAccess=async()=>{try{const r=await fetch(base+'/api/access',{cache:'no-store',redirect:'error'});if(r.status===401||r.status===403){ui.clear();history.replaceState(null,'',location.href);document.getElementById('hotel-error').hidden=false;}else if(r.ok){const data=await r.json();ui.setUser(data.user);}}catch{/* No provider responses or private information in logs. */}};
setInterval(()=>{if(document.visibilityState==='visible')void checkAccess();},30000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void checkAccess();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});

void checkAccess();
