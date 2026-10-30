import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./booklets/index.html',import.meta.url),'utf8');
function ui(){const ctx={URL,Map,draft:{body:{sanityBooking:{id:'fictional-booking'}}},ticketPortalCache:new Map(),ticketProviderNames:{obb:'ÖBB',sbb:'SBB'},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;')};runInNewContext(['safeTicketPortal','rememberTicketPortals','ticketPortalActions'].map(n=>source.split('\n').find(l=>l.startsWith('function '+n+'('))).join('\n'),ctx);return ctx;}
const sbb='https://shop.sbb.ch/customer/de/alw/order?orderId=00000000-0000-4000-8000-000000000001',obb='https://shop.oebbtickets.at/en/ticket/postcheckout/fictional-example';
function result(url){return {references:['ABC123'],messages:[{reference:'ABC123',latest:true,tickets:[],manualLinks:[{url}]}]};}
test('SBB and ÖBB portal actions coexist and remain bound to the current booking',()=>{
 const c=ui(),slot={};c.rememberTicketPortals(slot,result(obb),'obb');c.rememberTicketPortals(slot,result(sbb),'sbb');const html=c.ticketPortalActions(slot,0);assert(html.includes('ÖBB-ticketpagina openen'));assert(html.includes('SBB-ticketpagina openen'));assert(html.includes('referrerpolicy="no-referrer"'));
 const complete=result(sbb);complete.messages[0].tickets=[{id:'fictional-ticket'}];c.rememberTicketPortals(slot,complete,'sbb');assert(!c.ticketPortalActions(slot,0).includes('SBB-ticketpagina'));assert(c.ticketPortalActions(slot,0).includes('ÖBB-ticketpagina'));
 c.draft.body.sanityBooking.id='different-booking';assert(!c.ticketPortalActions(slot,0).includes(obb));
});
test('portal buttons reject external hosts, payment actions and extra SBB parameters',()=>{
 const c=ui();assert.equal(c.safeTicketPortal(sbb),sbb);for(const url of [sbb.replace('shop.sbb.ch','evil.example'),sbb+'&refund=true',sbb.replace('/order?','/payment?'),sbb.replace('https:','http:')])assert.equal(c.safeTicketPortal(url),'');
});
test('a bundled mail covers both references, while separate Drive tickets retain their own reference',async()=>{
 const c=ui();let calls=0;c.api=async()=>{calls++;return {items:['ABC123','XYZ789'].map((reference,i)=>({id:'fictional-file-'+i,title:'Rail Europe ticket.pdf',reference}))};};
 const start=source.indexOf('async function enrichDriveTickets('),end=source.indexOf('\nfunction ticketDriveSearch(',start);runInNewContext(source.slice(start,end),c);
 const message={reference:'ABC123',references:['ABC123','XYZ789'],latest:true,tickets:[{id:'fictional-bundle'}]},result={query:'1234',references:['ABC123','XYZ789'],messages:[message]};
 await c.enrichDriveTickets(result,'raileurope');assert.equal(calls,0);
 message.tickets=[];await c.enrichDriveTickets(result,'raileurope');assert.equal(calls,1);assert.equal(message.tickets.length,2);assert.equal(message.tickets[0].reference,'ABC123');assert.equal(message.tickets[1].reference,'XYZ789');
});
