import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBookletsBookings} from './booklets-bookings.mjs';
import {sanityTicketAttachments} from './booklets-sanity-tickets.mjs';
const id='file-'+('a'.repeat(40))+'-pdf',raw=Buffer.from('%PDF-fictional'),other='file-'+('b'.repeat(40))+'-pdf';
function fixture(){const booking={_id:'fictional-book',index:1234,documents:[{title:'Treintickets',asset:{_id:id,mimeType:'application/pdf',originalFilename:'tickets.pdf',size:raw.length,url:'https://cdn.sanity.io/files/fixture/production/'+('a'.repeat(40))+'.pdf'}}]},requests=[];const api=createBookletsBookings({configuration:()=>({project:'fixture',dataset:'production',token:'fictional-only'}),fetcher:async(u,init)=>{requests.push({u,init});assert(!init.method||init.method==='GET');return u.hostname==='cdn.sanity.io'?new Response(raw):Response.json({result:[booking]});}});return {api,booking,requests};}
test('Sanity uploads are attached to the exact booking and only read with GET',async()=>{
 const f=fixture(),r=await f.api.ticketSearch({bookingId:'fictional-book',query:'1234'});assert.equal(r.providerKey,'sanity');assert(r.messages[0].automatic);assert.equal(r.messages[0].tickets[0].sanity.kind,'ticket');
 const meta=await f.api.attachment({bookingId:'fictional-book',documentId:id,kind:'ticket',metadataOnly:true});assert.equal(meta.kind,'ticket');assert.equal(f.requests.length,2);
 const full=await f.api.attachment(r.messages[0].tickets[0].sanity);assert.deepEqual(Buffer.from(full.originalPdf,'base64'),raw);
 await assert.rejects(f.api.ticketSearch({bookingId:'fictional-book',query:'9999'}),/hoort niet/);
 await assert.rejects(f.api.attachment({bookingId:'fictional-book',documentId:other,kind:'ticket'}),/hoort niet/);
});
test('unknown Sanity PDF names require manual choice; invoices and vouchers stay excluded',async()=>{
 const f=fixture();f.booking.documents[0].title='Bijlage';f.booking.documents[0].asset.originalFilename='document.pdf';let r=await f.api.ticketSearch({bookingId:'fictional-book',query:'1234'});assert(!r.messages[0].automatic);assert(!r.messages[0].selected);assert.match(r.messages[0].diagnostic,/Kies/);
 for(const filename of ['hotel-voucher.pdf','invoice.pdf','sales-receipt.pdf','Additional Services.pdf']){f.booking.documents[0].asset.originalFilename=filename;assert.equal(sanityTicketAttachments(f.booking).length,0);}
});
test('Sanity CDN paths, sizes, source association and immutable IDs are revalidated',async()=>{
 for(const change of [a=>a.url='https://foreign.example/ticket.pdf',a=>a.url+='?token=unexpected',a=>a.size=0,a=>a.size=raw.length+1]){const f=fixture();change(f.booking.documents[0].asset);await assert.rejects(f.api.attachment({bookingId:'fictional-book',documentId:id,kind:'ticket'}));}
 const f=fixture();await assert.rejects(f.api.attachment({bookingId:'fictional-book',documentId:id}),/hoort niet/);f.booking.documents=[];await assert.rejects(f.api.attachment({bookingId:'fictional-book',documentId:id,kind:'ticket',metadataOnly:true}),/hoort niet/);
});
