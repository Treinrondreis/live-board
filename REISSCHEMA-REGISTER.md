# Reisschema’s: zoeken en wijzigingen

Het zelfstandige Seinhuis-onderdeel vereist bestaande eigenaarstoegang.
Een reisperiode selecteert overlappende ritten, inclusief een nachtrit die de
volgende dag aankomt. Vandaag/morgen/overmorgen gebruiken Europe/Amsterdam.
Meerdere treinnummers worden als OF gecombineerd; periode, traject en boeking
beperken die gezamenlijke selectie. De trajectwoorden moeten in reisvolgorde
voorkomen, zonder exacte stationsnamen te vereisen.

De oorspronkelijke tijden blijven uit het centrale register komen. De nieuwe
planning is een afzonderlijke broncontrole, met bron en controletijd. Automatisch
vergelijken gebruikt uitsluitend eenduidige, volledige planning uit het bestaande
ritarchief, met beide stations in de juiste volgorde en een bron later dan de
registratie van het schema. Er worden geen realtimemetingen als nieuwe geplande
tijden gepresenteerd. Zonder bewijs staat er geen bevestiging.

Een uitroepteken verschijnt bij minstens vier minuten eerder vertrek, uitval of
een bewezen onhaalbare aansluiting zonder gecommuniceerde passende back-up.
Wijzigingen in tijden worden doorgestreept met de nieuwe tijd eronder. Het
groene vinkje vereist expliciete registratie van communicatie voor precies die
wijziging. Nieuwe tijden of aansluitstatus maken de oude registratie niet
opnieuw toepasselijk. Een geschikte back-up moet afzonderlijk als gecommuniceerd
worden vastgelegd; alleen het bestaan van een andere trein is onvoldoende.

De POST-routes vereisen eigenaarstoegang, eigen Origin, JSON en X-Reisschemas.
De bestaande private Flora-servicecredential mag alleen broncontrole en
communicatie toevoegen. Geen schema’s, originele tijden of Sanity worden
aangepast. De server verstuurt geen e-mail en laat geen geheime sleutel aan de
browser zien. Het centrale register moet de leg-events-uitbreiding hebben
voordat de schrijfknoppen live gaan.

Controles: node --test flora-register-ui.test.mjs reisschema-changes.test.mjs
reisschemas.test.mjs reisschemas-write.test.mjs flora-register.test.mjs.
Gebruik uitsluitend fictieve gegevens in test- en previewbestanden.
