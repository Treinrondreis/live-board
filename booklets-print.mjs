// Printer credentials stay in the main service; private PDF bytes never get public URLs.
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import options from './booklets-print-options.json' with {type:'json'};
import {bookletsBookings} from './booklets-bookings.mjs';

const ID=/^[a-f0-9]{32}$/,MAX=512*1024*1024;
const defaults={copies:2,paper:'100',cover:'250',color:'all',production:'standard'};
const names=new Intl.DisplayNames(['nl'],{type:'region'});
export const printCountries=options.countries.map(code=>({code,name:names.of(code)})).sort((a,b)=>a.name.localeCompare(b.name,'nl'));
export function printCountry(value){
 const raw=typeof value==='string'?value.trim():'',upper=raw.toUpperCase();
 if(options.countries.includes(upper))return upper;
 const aliases={nederland:'NL',netherlands:'NL',holland:'NL',belgie:'BE','belgië':'BE',belgium:'BE',duitsland:'DE',germany:'DE',deutschland:'DE',frankrijk:'FR',france:'FR','verenigd koninkrijk':'GB','united kingdom':'GB',uk:'GB',engeland:'GB',oostenrijk:'AT',austria:'AT','österreich':'AT'};
 return (Object.hasOwn(aliases,raw.toLowerCase())?aliases[raw.toLowerCase()]:'')||printCountries.find(c=>c.name.toLowerCase()===raw.toLowerCase())?.code||'';
}
export function printAddress(booking){
 const raw=typeof booking.address==='string'?booking.address.trim():'',tail=raw.match(/^(.+?)\s+(\d+)(?:\s*[- ]?\s*([\p{L}\d/-]+))?$/u),head=raw.match(/^(\d+)\s+(.+)$/);
 return {contact:[booking.firstName,booking.lastName].filter(Boolean).join(' '),street:tail?.[1]||head?.[2]||raw,number:tail?.[2]||head?.[1]||'',number_ext:tail?.[3]||'',postalcode:booking.postalCode||'',city:booking.city||'',country:printCountry(booking.country)};
}
function text(value,max,required=false){if(typeof value!=='string'||value.trim().length>max||/[\x00-\x1f\x7f]/.test(value)||required&&!value.trim())throw Error('Controleer de naam en het volledige afleveradres.');return value.trim();}
export function printSettings(input,pages){
 const c=input||{},address=c.address||{};
 const out={contact:text(address.contact,35,true),street:text(address.street,95,true),number:text(address.number,35,true),number_ext:text(address.number_ext||'',35),postalcode:text(address.postalcode,17,true),city:text(address.city,35,true),country:printCountry(address.country)};
 if(!out.country)throw Error('Kies het afleverland expliciet; een ontbrekend land wordt niet als Nederland behandeld.');
 const postal={NL:/^[1-9]\d{3}\s?[A-Z]{2}$/i,BE:/^\d{4}$/,DE:/^\d{5}$/,FR:/^\d{5}$/,GB:/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i};
 if(postal[out.country]&&!postal[out.country].test(out.postalcode))throw Error('De postcode past niet bij het gekozen land.');
 if(!Number.isInteger(c.copies)||c.copies<1||c.copies>1000)throw Error('Kies 1 tot 1000 exemplaren.');
 if(!options.paper.includes(c.paper)||!options.covers.includes(c.cover)||!['all','cover','none'].includes(c.color)||!['standard','fast','budget'].includes(c.production))throw Error('Kies geldige papier- en productie-instellingen.');
 if(!Number.isInteger(pages)||pages<8||pages%4)throw Error('Maak een druk-PDF met minimaal acht pagina’s en een veelvoud van vier pagina’s.');
 return {...out,delivery_method:out.country==='NL'?'post':'international',delivery_option:'standard',production_method:c.production,articles:[{product:'tijdschrift',add_file_method:'email',number:pages,copies:c.copies,size:'a4',printside:'double',color:c.color,papertype:c.paper,papertype_cover:c.cover,finishing_cover:'none',finishing:'folding-stapling',folding:'middle_long',finishing_extra:'none',check_doc:false}]};
}
export function printPrice(data){
 const amount=data?.amount,shipping=data?.delivery_amount,reduced=data?.amount_tax_reduced,standard=data?.amount_tax_standard;
 if([amount,shipping,reduced,standard].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0)||amount<shipping)throw Error('Print&Bind gaf geen volledige prijs inclusief btw en verzending.');
 const cents=n=>Math.round(n*100);return {totalCents:cents(amount)+cents(reduced)+cents(standard),taxCents:cents(reduced)+cents(standard),shippingExTaxCents:cents(shipping),deliveryAt:typeof data.delivery_at==='string'?data.delivery_at:null};
}
const publicRecord=r=>r?{state:r.state,reference:r.payload.reference,orderId:r.payload.orderId||null,status:r.payload.status||null,totalCents:r.payload.totalCents,environment:r.payload.environment}:null;
export function createBookletPrinter({fetcher=(...a)=>fetch(...a),bookings=bookletsBookings,now=()=>Date.now(),configuration=()=>({token:process.env.PRINTENBIND_API_TOKEN,sandboxToken:process.env.PRINTENBIND_SANDBOX_API_TOKEN,environment:process.env.PRINTENBIND_ENVIRONMENT||'live',upstream:process.env.BOOKLETS_INTERNAL_URL,secret:process.env.BOOKLETS_GATEWAY_SECRET})}={}){
 function config(){const c=configuration();if(!['live','sandbox'].includes(c.environment))throw Error('Kies live of sandbox voor Print&Bind.');const token=c.environment==='sandbox'?c.sandboxToken:c.token;if(!token)throw Error('De Print&Bind-toegang is niet ingesteld voor deze omgeving.');const u=new URL(c.upstream);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!c.secret||c.secret.length<32)throw Error('De privéverbinding met Boekjesmaker ontbreekt.');return {...c,token,upstream:u.origin,api:'https://'+(c.environment==='sandbox'?'sandbox':'www')+'.printenbind.nl/api/rest'};}
 async function json(response,limit=262144){const parts=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>limit)throw Error('Onverwacht antwoord van de drukwerkservice.');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('Ongeldig antwoord van de drukwerkservice.');}}
 async function internal(action,body,raw=false){const c=config();let r;try{r=await fetcher(c.upstream+'/internal/print-orders/'+action,{method:'POST',headers:{'X-Booklets-Gateway':c.secret,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(110000)});}catch{throw Error('De privéverbinding met de druk-PDF is onderbroken.');}if(!r.ok){const error=await json(r);throw Error(error.error||'De drukversie is niet beschikbaar.');}return raw?r:json(r);}
 async function printer(path,body,upload){if(['/orders','/orders/calculate'].includes(path)&&body?.articles)body={...body,articles:body.articles.map(a=>JSON.stringify(a))};const c=config();let r;try{r=await fetcher(c.api+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+c.token,Accept:'application/json',...(upload?upload.headers:body?{'Content-Type':'application/json'}:{})},...(upload?{body:upload.body,duplex:'half'}:body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(upload?150000:path==='/orders/calculate'?90000:30000)});}catch{throw Error('Geen bevestiging van Print&Bind ontvangen.');}if(!r.ok){await r.body?.cancel();throw Object.assign(Error('Print&Bind weigert deze actie (HTTP '+r.status+'). Controleer de drukinstellingen, het adres en de accounttoegang.'),{rejected:[400,422].includes(r.status)});}return (await json(r)).data;}
 async function meta(exportId){if(!ID.test(exportId||''))throw Error('Kies een gemaakte PDF.');return internal('metadata',{exportId});}
 async function update(q,state,receipt={}){return internal('update',{exportId:q.exportId,quoteId:q.id,state,receipt});}
 async function recover(r,exportId){
  if(!r||!['submitting','uncertain','placed'].includes(r.state))return publicRecord(r);
  if(r.payload.environment!==config().environment)throw Error('Deze bestelling hoort bij een andere Print&Bind-omgeving.');
  try{const data=r.payload.orderId?await printer('/orders/'+r.payload.orderId):await printer('/orders/search',{reference:r.payload.reference});if(!Number.isInteger(data?.id)||data.id<1||data.reference!==r.payload.reference)throw Error();await update({id:r.quote_id,exportId},'placed',{orderId:data.id,status:String(data.status||'').slice(0,100)});return publicRecord(await internal('record',{exportId}));}catch{return publicRecord(r);}
 }
 return {
  async prepare(b){const m=await meta(b.exportId),address=printAddress(await bookings.address({bookingId:m.bookingId}));return {meta:m,address,defaults,paper:options.paper,covers:options.covers,countries:printCountries,environment:config().environment,order:await recover(await internal('record',{exportId:m.id}),m.id)};},
  async quote(b){const m=await meta(b.exportId),payload=printSettings(b.settings,m.pages),reference='TRR-'+m.id,price=printPrice(await printer('/orders/calculate',{...payload,reference}));const q={id:randomUUID().replaceAll('-',''),exportId:m.id,pdf:m,payload,reference,price,environment:config().environment,credential:createHash('sha256').update(config().token).digest('hex'),expires:now()+15*60000};await internal('quote',{exportId:m.id,quote:q});return {id:q.id,exportId:q.exportId,price,expires:q.expires,environment:q.environment};},
  async status(b){if(!ID.test(b.exportId||''))throw Error('Kies een PDF.');return {order:await recover(await internal('record',{exportId:b.exportId}),b.exportId)};},
  async order(b){
   if(b.confirmed!==true||!ID.test(b.quoteId||'')||!ID.test(b.exportId||''))throw Error('Bevestig eerst de PDF, het afleveradres en het totaalbedrag.');
   const q=await internal('get-quote',{exportId:b.exportId,quoteId:b.quoteId});
   const existing=await internal('record',{exportId:q.exportId});if(existing&&!['upload_failed','rejected'].includes(existing.state))return {order:await recover(existing,q.exportId)};
   if(q.expires<now()||q.environment!==config().environment||q.credential!==createHash('sha256').update(config().token).digest('hex'))throw Error('Prijsopgave verlopen of toegang gewijzigd. Bereken opnieuw.');
   const m=await meta(q.exportId);if(m.sha256!==q.pdf.sha256||m.pages!==q.pdf.pages||m.bookingId!==q.pdf.bookingId)throw Error('De PDF of boeking is gewijzigd. Bereken opnieuw.');
   const fresh=printPrice(await printer('/orders/calculate',{...q.payload,reference:q.reference}));if(fresh.totalCents!==q.price.totalCents)throw Error('De prijs is gewijzigd. Bereken opnieuw en bevestig het nieuwe bedrag.');
   const claim=await internal('claim',{exportId:q.exportId,quoteId:q.id});if(!claim.claimed)return {order:await recover(claim,q.exportId)};
   const filename='reisboekje-'+q.exportId+'-'+q.pdf.sha256.slice(0,16)+'.pdf';let pdfResponse,uploadBody;
   try{
    const pdf=await internal('pdf',{exportId:q.exportId,sha256:q.pdf.sha256},true),boundary='booklet-'+randomUUID(),header=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+filename+'"\r\nContent-Type: application/pdf\r\n\r\n'),footer=Buffer.from('\r\n--'+boundary+'--\r\n');
    pdfResponse=pdf;
    if(Number(pdf.headers.get('content-length'))!==q.pdf.size||q.pdf.size>MAX){await pdf.body?.cancel();throw Error('De PDF-grootte is gewijzigd.');}
    const body=Readable.from((async function*(){let length=0;const hash=createHash('sha256');yield header;for await(const chunk of pdf.body){length+=chunk.length;if(length>q.pdf.size)throw Error('Onvolledige PDF.');hash.update(chunk);yield chunk;}if(length!==q.pdf.size||hash.digest('hex')!==q.pdf.sha256)throw Error('PDF-controle mislukt.');yield footer;})());
    uploadBody=body;body.on('error',()=>{});
    const uploaded=await printer('/documents',{}, {body,headers:{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':String(header.length+q.pdf.size+footer.length)}});
    if(uploaded?.name!==filename||Number(uploaded.size)!==q.pdf.size)throw Error('De PDF-upload is niet bevestigd.');
   }catch(error){uploadBody?.destroy();try{await pdfResponse?.body?.cancel();}catch{}await update(q,'upload_failed');throw error;}
   await update(q,'submitting');
   try{const data=await printer('/orders',{...q.payload,reference:q.reference,articles:q.payload.articles.map(a=>({...a,add_file_method:'upload',filenames:filename}))});if(!Number.isInteger(data?.id)||data.id<1||data.reference!==q.reference)throw Error();await update(q,'placed',{orderId:data.id,status:String(data.status||'').slice(0,100)});}catch(error){await update(q,error.rejected?'rejected':'uncertain');if(error.rejected)throw error;}
   return {order:await recover(await internal('record',{exportId:q.exportId}),q.exportId)};
  }
 };
}
export const bookletPrinter=createBookletPrinter();
