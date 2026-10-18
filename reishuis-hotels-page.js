import {createHotelsUI} from './reishuis-hotels-ui.js';
const base='/seinhuis/reishuis',node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const params=()=>new URL(location.href).searchParams,identity=v=>typeof v==='string'&&/^[-a-zA-Z0-9_.]{1,160}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v),backBooking=params().get('returnBooking');let rendering=false;
const update=(id,tab,search=history.state?.hotelSearch||'')=>{if(rendering)return;const u=new URL(location.href);if(id)u.searchParams.set('id',id);else u.searchParams.delete('id');if(tab)u.searchParams.set('tab',tab);else u.searchParams.delete('tab');if(u.href!==location.href){history.replaceState({hotelSearch:search},'',location.href);history.pushState({hotelSearch:search},'',u);}};
const ui=createHotelsUI({node,base,onDenied:()=>{ui.clear();document.getElementById('hotel-error').hidden=false;},onClose:()=>location.assign(base+'/'+(identity(backBooking)?'?'+new URLSearchParams({booking:backBooking}):'')),onSelect:update,onList:()=>update(null)});
const render=async()=>{rendering=true;try{const p=params(),id=p.get('id');if(identity(id))await ui.openHotel(id,{tab:p.get('tab'),search:(history.state?.hotelSearch||p.get('q')||'').slice(0,160)});else await ui.open({search:(history.state?.hotelSearch||p.get('q')||'').slice(0,160)});}finally{rendering=false;}};
window.addEventListener('popstate',()=>void render());void render();

const checkAccess=async()=>{try{const r=await fetch(base+'/api/access',{cache:'no-store',redirect:'error'});if(r.status===401||r.status===403){ui.clear();history.replaceState(null,'',location.href);document.getElementById('hotel-error').hidden=false;}}catch{/* No provider responses or private information in logs. */}};
setInterval(()=>{if(document.visibilityState==='visible')void checkAccess();},30000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void checkAccess();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
