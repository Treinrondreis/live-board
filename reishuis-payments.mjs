import {dayInAmsterdam} from './reishuis-view.mjs';

export const paymentLabels={none:'Geen betaalverzoek',paid:'Volledig betaald',partial:'Deels betaald',unpaid:'Niet betaald',unknown:'Betaling controleren'};
function cents(value){
 if(typeof value==='string'&&/^-?\d+(?:[.,]\d{1,2})?$/.test(value))value=Number(value.replace(',','.'));
 return typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e9?Math.round(value*100):null;
}
function dueDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)||!Number.isFinite(Date.parse(value)))return null;
 if(new Date(value.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))return null;
 return value.length===10?value:dayInAmsterdam(new Date(value));
}
// Price and fulfillment amounts are in euros in the existing payment schema.
// A legacy paid status is used only when no detailed fulfillments are recorded.
export function paymentSummary(requests=[],today=dayInAmsterdam()){
 let requested=0,paid=0,outstanding=0,unknown=false,overdue=false,missingDue=false,nextDue=null;
 const active=(Array.isArray(requests)?requests:[]).filter(p=>p&&!['cancelled','canceled','void'].includes(String(p.status||'').toLowerCase()));
 const hasLink=active.some(p=>p.hasLink===true);
 for(const p of active){
  const price=cents(p.price),fulfillments=Array.isArray(p.fulfillments)?p.fulfillments:[];
  const values=fulfillments.map(f=>cents(f?.amount));
  if(price===null||price<0||values.some(v=>v===null)){unknown=true;continue;}
  const received=Math.max(0,fulfillments.length?values.reduce((a,b)=>a+b,0):p.status==='paid'?price:0),remaining=Math.max(0,price-received),due=dueDay(p.dateDue);
  requested+=price;paid+=received;outstanding+=remaining;
  if(remaining>0){if(!due)missingDue=true;else{overdue ||= due<today;if(!nextDue||due<nextDue)nextDue=due;}}
 }
 const status=!active.length?'none':unknown?'unknown':outstanding===0?'paid':paid>0?'partial':'unpaid';
 return {status,requested:requested/100,paid:paid/100,outstanding:outstanding/100,hasLink,requestCount:active.length,overdue,missingDue,nextDue};
}
export function matchesPayment(booking,filter=''){
 const p=booking.payment||paymentSummary(booking.payments);
 if(filter==='no-link')return !p.hasLink;
 if(filter==='overdue')return p.overdue;
 return !filter||p.status===filter;
}
