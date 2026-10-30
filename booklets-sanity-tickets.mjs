// Classify existing uploads only. Unknown PDFs require an explicit selection.
export function sanityTicketAttachments(booking){
 return (booking.documents||[]).filter(d=>d.asset?.mimeType==='application/pdf'&&/^file-[a-f0-9]{40}-pdf$/.test(d.asset._id||''))
 .filter(d=>!/invoice|factuur|rechnung|receipt|kvittering|voucher|hotel|accommodation|reisschema|tijdlijn|itinerary|additional[ _]services|\bI_F\d{9}_/i.test((d.title||'')+' '+(d.asset.originalFilename||'')))
 .map(d=>{const title=d.title||d.asset.originalFilename||'PDF-bijlage',name=title+' '+(d.asset.originalFilename||'');return {id:d.asset._id,title,attachment:true,kind:'ticket',recommended:/ticket|billett?|fahrkarte|j[ií]zdenka|m[ií]stenka|reserv(?:ation|ierung)|cora\d*|travel[ _-]*document/i.test(name)||/^T_F\d{9}_\d+\.pdf$|^T\d{9}\.pdf$/i.test(d.asset.originalFilename||'')};});
}
export function sanityTicketResult(booking,attachments){
 const reference=String(booking.index),automatic=attachments.every(a=>a.recommended);
 return {provider:'Sanity-uploads',providerKey:'sanity',query:reference,booking:reference,references:attachments.length?[reference]:[],referenceDates:[],journeyDates:[],travelDates:[],excludedInvoices:0,messages:attachments.length?[{id:'sanity:'+booking._id,reference,subject:'PDF-bijlagen van de gekozen Sanity-boeking',date:new Date().toISOString(),latest:true,selected:automatic,automatic,cancelled:false,diagnostic:automatic?'':'Niet alle Sanity-bijlagen zijn duidelijk als ticket herkenbaar. Kies de juiste PDF’s en pagina’s via Document kiezen / ophalen.',tickets:attachments.map(a=>({id:a.id,title:a.title,reference,sanity:{bookingId:booking._id,documentId:a.id,kind:'ticket'}})),manualLinks:[]}]:[]};
}
