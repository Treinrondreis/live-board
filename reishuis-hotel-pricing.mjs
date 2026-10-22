// Shared by protected calendar and dossier repricing. Never sorts source rules.
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const price=v=>typeof v==='number'?v:typeof v==='string'&&/^\d+(?:[.,]\d+)?$/.test(v.trim())?Number(v.trim().replace(',','.')):NaN;
const usable=v=>Number.isFinite(v)&&v<=10000000&&Math.round(v*100)>0;
const matches=(p,date)=>{
 if(p.start&&!validDate(p.start)||p.end&&!validDate(p.end))return false;
 return (!p.start||date>=p.start)&&(!p.end||date<=p.end)&&(!p.availableDays?.length||p.availableDays.includes(String(new Date(date).getUTCDay())));
};
export function hotelNight(hotel,room,date,hotels,{provider='',board=''}={}){
 if(hotel.pricingUnavailable)return {missing:'Tariefregels worden nog geladen. Probeer later opnieuw of vul het totaal handmatig in.',date};
 if(!validDate(date))return {missing:'Controleer de reisdatums.'};
 const rules=room.contractRates||[],mode=hotel.bookingPriceSource|| (rules.length?'cms':'apo');
 if(mode==='cms'||mode!=='apo'&&!room.apoRoom||!['apo','realtime','teldar','ratehawk'].includes(mode)){
  const index=rules.findIndex(r=>!r.available?.length||r.available.some(p=>matches(p,date)));
  if(index<0)return {missing:'Geen geldig contracttarief op '+date+'. Vul het totaal handmatig in.',date};
  const value=price(rules[index].price),rule=index+1;
  // A matching unavailable/malformed rule must never fall through to a lower price.
  if(!usable(value))return {missing:'Contracttarief niet beschikbaar of ongeldig op '+date+'. Toch wijzigen? Vul zelf een tarief in.',unavailable:true,date,rule};
  return {date,price:Math.round(value*100)/100,source:'Contract',rule};
 }
 const ref=room.apoRoom,rate=ref&&hotels.find(h=>h.id===ref.docId)?.apoRooms.find(r=>'apoRooms.'+r.key===ref.path);
 if(!rate)return {missing:'Geen APO-koppeling voor deze kamer. Vul het totaal handmatig in.',date};
 const rates=rate.prices.filter(p=>p.date.slice(0,10)===date&&p.boardType===board&&p.source===provider);
 if(rates.length!==1||typeof rates[0].price!=='number'||!Number.isFinite(rates[0].price)||rates[0].price<0)return {missing:'Geen eenduidig tarief op '+date+'. Vul het totaal handmatig in.',date};
 if(!usable(rates[0].price))return {missing:'Niet beschikbaar voor deze datum: '+date+'. Toch wijzigen? Vul zelf een tarief in en controleer de beschikbaarheid.',unavailable:true,date};
 return {date,price:rates[0].price,source:rates[0].source,lastUpdate:rates[0].lastUpdate};
}
export function hotelCalendar(hotel,room,month,hotels,choice){
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!validDate(month+'-01'))return null;
 const first=new Date(month+'-01T00:00:00Z'),days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 return {month,days:Array.from({length:days},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0');return {date,...hotelNight(hotel,room,date,hotels,choice)};})};
}
