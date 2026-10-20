// Compare the same stay and meal basis. Unknown data must never become a saving.
export function breakfastBasis(value){const s=String(value||'').toLowerCase();const no=/zonder ontbijt|excl\.?\s*ontbijt|\b(?:ro|room.?only)\b/.test(s),yes=/(?:incl\.?|inclusief|met)\s*ontbijt|\bbb\b|bed.?and.?breakfast/.test(s);return no&&yes?'conflict':!no&&!yes?null:yes;}
export function comparableStay({base,source,hotel,room,component,line,originalLine,todo,originalHotel}){
 const wanted=breakfastBasis([originalLine?.title,todo?.title].filter(Boolean).join(' '))??breakfastBasis(originalHotel?.meals),current=source==='Contract'?breakfastBasis(hotel.meals):breakfastBasis(component.board);
 const result={basePrice:base,price:null,breakfast:typeof wanted!=='boolean'?'Onbekend':wanted?'Inclusief ontbijt':'Zonder ontbijt',reason:''};
 if(typeof wanted!=='boolean'){result.reason='Ontbijt in de oorspronkelijke boeking is niet eenduidig vastgelegd.';return result;}
 if(typeof current!=='boolean'){result.reason='Maaltijdtype van het actuele tarief is onbekend.';return result;}
 if(wanted===current){result.price=base;return result;}
 if(!wanted){result.reason='Actueel tarief bevat ontbijt; oorspronkelijke boeking niet. Geen gelijke vergelijking.';return result;}
 const unit=hotel.breakfastUnit,people=component.breakfastPersons,nights=(Date.parse(component.checkout)-Date.parse(component.checkin))/86400000;
 if(!['person','room'].includes(unit)||!Number.isFinite(hotel.breakfast)||hotel.breakfast<0||!Number.isInteger(nights)||nights<1||unit==='person'&&(!Number.isInteger(people)||people<1)){result.reason='Ontbijttoeslag, eenheid of werkelijk aantal ontbijtgasten ontbreekt.';return result;}
 result.breakfast='Inclusief ontbijt · '+(unit==='person'?people+' personen':component.rooms+' kamers');result.price=Math.round((base+hotel.breakfast*nights*(unit==='person'?people:component.rooms))*100)/100;return result;
}
