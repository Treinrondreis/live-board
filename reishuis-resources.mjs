import {bookletsBookings} from './booklets-bookings.mjs';
import {createRegisterClient} from './reisschema-register-client.mjs';

// Read only, fixed existing integrations; never trust a client-supplied URL or booking number.
export function itineraryLink(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!['docs.google.com','drive.google.com'].includes(u.hostname))return null;
 const doc=u.hostname==='docs.google.com'&&u.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/),file=u.hostname==='drive.google.com'&&u.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
 if(doc)return {url:'https://docs.google.com/document/d/'+doc[1]+'/edit',pdf:'https://docs.google.com/document/d/'+doc[1]+'/export?format=pdf'};
 if(file)return {url:'https://drive.google.com/file/d/'+file[1]+'/view',pdf:'https://drive.google.com/uc?export=download&id='+file[1]};return null;
 }catch{return null;}
}
export function createReishuisResources({documents=bookletsBookings,findLegs=async dossier=>createRegisterClient({baseUrl:process.env.REISSCHEMA_REGISTER_URL,token:process.env.REGISTER_FLORA_TOKEN}).findLegs({dossier})}={}){
 return {async overview(booking,all){
 const result={itinerary:{available:false,legs:[],documents:[]},letters:[],documentsAvailable:false,ambiguous:false};
 // A number is insufficient if several distinct Sanity bookings share it.
 const number=String(booking.index).trim().toUpperCase(),canonical=v=>String(v).trim().toUpperCase().replace(/A$/,'');
 if(!/^\d{3,8}A?$/.test(number)||all.filter(b=>canonical(b.index)===canonical(number)).length!==1)result.ambiguous=true;
 else try{const rows=(await Promise.all([findLegs(canonical(number)),findLegs(canonical(number)+'A')])).flat(),selected=rows.filter(r=>canonical(r.dossier)===canonical(number)&&r.status==='active');
 result.itinerary={available:true,legs:[...new Map(selected.map(r=>[r.leg_id||JSON.stringify(r),r])).values()].slice(0,500).map(r=>({date:r.travel_date,from:r.from_station,to:r.to_station,departure:r.departure_time,arrival:r.arrival_time,train:r.train_number,role:r.role})),documents:[...new Map(selected.map(r=>itineraryLink(r.document_url)).filter(Boolean).map(r=>[r.url,r])).values()]};
 }catch{result.itinerary.error='Reisschemaregister tijdelijk niet bereikbaar.';}
 try{const data=await documents.documents({bookingId:booking.id});result.letters=data.items.filter(d=>d.kind==='letter').map(d=>({id:d.id,title:d.title}));result.documentsAvailable=true;}catch{result.documentsError='Documenten tijdelijk niet beschikbaar.';}
 return result;
 },async letter(bookingId,documentId){const listing=await documents.documents({bookingId});if(!listing.items.some(d=>d.id===documentId&&d.kind==='letter'))throw Error('Brief hoort niet bij deze boeking.');const doc=await documents.document({bookingId,documentId,originalPdf:true});const bytes=Buffer.from(doc.originalPdf||'','base64');if(!bytes.length||bytes.length>30*1024*1024||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('Brief niet beschikbaar.');return bytes;}};
}
export const reishuisResources=createReishuisResources();
