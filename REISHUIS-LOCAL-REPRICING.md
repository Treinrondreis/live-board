# Lokale onderdelen, tarieven en herberekenen

## Bediening
Open een todo, vervolgens Onderdeel wijzigen en herberekenen. Kies bij de eerste wijziging expliciet de financiële regel: bronregels hebben geen betrouwbare onderlinge referentie. Reishuis onthoudt de koppeling. Een financiële regel mag niet bij twee taken horen. Een bestaande koppeling wordt niet stilzwijgend naar een andere regel verplaatst.

Naam aanpassen behoudt het bestaande totaal, of gebruikt een expliciet handmatig totaal. Hotelwijzigingen kiezen hotel, kamer, check-in/check-out of aantal nachten, aantal kamers en een leverancier/maaltijdtype. Alleen een exact APO-tarief per verblijfsnacht wordt gebruikt, check-out exclusief. Bij ontbrekende of dubbele tarieven is een handmatig totaal nodig; er is geen gok op een andere kamer/leverancier. Er worden geen marges, kortingen of ontbijtbedragen bij verzonnen. Een handmatig totaal kan eventuele toeslagen bevatten.

Interrail kiest een expliciet Sanity-basistarief (dagen/geldigheid), klasse, doelgroep en aantal passen. Geen automatische toepassing van kortingsdocumenten of toeslagen. Optiebedragen blijven bij verschuiven en Interrail-herberekening gelijk. Een optie kan afzonderlijk worden gewijzigd met behoud van bedrag of een bewust ingevoerd nieuw totaal.

Bij extra nachten toont de editor gedateerde vervolgonderdelen vanaf de oude check-out. De gebruiker kan vaste datums uitsluiten. Geselecteerde taken schuiven met het verschil in check-out, inclusief deadline/boekbaar-vanaf waar aanwezig. Gekoppelde vervolghotels worden opnieuw berekend. Een ongekoppeld vervolghotel blokkeert bevestigen: eerst aan hotel/kamer/financiële regel koppelen. Handmatige bedragen zijn mogelijk voor ontbrekende vervolgtarieven.

Herberekenen schrijft niets. Het voorstel toont wijzigingen en oude/nieuwe reissom; onbekende bestaande financiële regels blijven als onbekend zichtbaar. Waarschuwingen moeten worden bevestigd en daarna opnieuw berekend. De server ondertekent het voorstel voor sessie, gebruiker, invoer, databaseversie, bronversie en tariefversies; tien minuten geldig. Bevestigen herberekent en controleert dit opnieuw. De todo en financiën worden samen via de bestaande optimistische Postgres-schrijfactie opgeslagen; bij conflict niets overschrijven.

Een nieuwe berekende prijs wordt als totaal voor dit onderdeel opgeslagen (financiële hoeveelheid 1). Werkelijke kosten worden bij herberekening onbekend en moeten gecontroleerd worden; de oude kosten blijven in de lokale historie. Naamwijziging met tarief behouden laat hoeveelheid, prijs en kosten gelijk. Werkelijke kosten kunnen nog steeds afzonderlijk in financiën worden ingevuld. Gekoppelde namen, data, hoeveelheden en berekende prijzen lopen via de onderdeel-editor om tegenstrijdige wijzigingen te voorkomen.

Een inhoudelijk gewijzigde afgeronde taak krijgt een nieuwe actieve versie en een bewaarde oude versie met uitroepteken. Na aanvinken van de controle gaat de oude versie onderaan als Gearchiveerd. De historie is lokaal en alleen-lezen; oude financiële snapshots tellen niet mee in de reissom. De status van lokaal herberekende taken wordt lokaal vastgehouden zodat een latere statuswijziging van de oude Sanity-taak niet de nieuwe versie afvinkt.

Hotelpagina openen gaat bij een gekoppeld hotel direct naar de lokale hotelpagina. Bij oudere ongekoppelde hotel-todo’s opent het hoteloverzicht met een zoekvoorstel; er wordt niet op een mogelijk ambigue naam automatisch gekoppeld.

## Tariefopslag en planning
Een aparte reishuis_catalog-tabel in de bestaande Postgres-opslag bewaart volledige laatste succesvolle catalogi en de bijgewerkte bronrecords. Geen productiegegevens of exports in Git. De eerste ingebruikname leest beide catalogi; een serverherstart hergebruikt de opslag.

Hotels: 08:15, 12:15 en 15:15 Europe/Amsterdam. Interrail: eenmaal per nacht om 03:15, uitsluitend 20 december t/m 20 januari inclusief. Een lichte server-timer controleert per minuut of een tijdvak nog ontbreekt; bij uitval wordt het laatst gemiste tijdvak na herstart ingehaald. Geen continue Sanity-aanvragen bij iedere paginaverversing, en de eerdere vijfminuten-cache is alleen nog een testadapter.

Elke controle leest eerst uitsluitend document-ID en _updatedAt. Alleen nieuwe/gewijzigde records worden inhoudelijk opgehaald; verwijderde records worden uit de catalogus verwijderd. Concepten hebben voorrang, bij verwijderen van een concept valt de catalogus terug op de gepubliceerde versie. Een onvolledige of tussentijds gewijzigde leesronde vervangt de vorige snapshot niet. Mislukte controles proberen na een minuut opnieuw. De APO zelf wordt niet gestart en er worden geen tarieven bij leveranciers opgevraagd.

## Bescherming en verificatie
Sanity uitsluitend GET op vast project/dataset en vaste veldprojecties, met de bestaande Viewer-configuratie. Geen Sanity-mutaties, nieuwe tokens of rolverruiming. Expliciete Reishuis-rol op pagina’s/API/modules/foto’s; bestaande same-origin/CSRF en private/no-store/privacyheaders blijven actief. Alleen geautoriseerde dossieraanvragen bevatten dossiergegevens. Geen providerresponsen of klantinformatie in logs.

Tests gebruiken uitsluitend fictieve gegevens. Aanvullende unit- en browsertests dekken hotelnachten/kamers, ontbrekende tarieven, gratis kinderpassen, klassewaarschuwing, lokale atomische wijzigingen, archivering, behouden optiebedragen, datumverschuiving, vaste uitzonderingen, ontbrekende koppelingen, handmatige prijzen, ondertekende bevestiging, verlopen/tussentijds gewijzigde voorstellen, CSRF/rol/herkomst en mobiele bediening. Catalogtests dekken Nederlandse tijd en seizoensgrenzen, incrementele wijzigingen, conceptverwijdering, onvolledige bronlezingen en herstart met opgeslagen gegevens.

## Niet-beschikbare hotelnachten
Een APO-hoteltarief van nul (of afgerond minder dan één cent) betekent niet beschikbaar. Eén onbeschikbare nacht blokkeert de volledige automatische verblijfsprijs en de bevestiging; de nieuwe reissom blijft onbekend in plaats van naar nul te dalen. De kalender markeert dit met × Niet beschikbaar. De gebruiker kan bewust kiezen voor Toch wijzigen? Handmatig tarief invullen, moet een positief totaal in eurocenten invullen en de beschikbaarheidswaarschuwing bevestigen. Dit geldt ook voor meegeschoven vervolghotels. Gratis Interrail-varianten blijven toegestaan. Er worden geen bestaande klantboekingen of Sanity-records automatisch gecorrigeerd.
