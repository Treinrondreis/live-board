# Reishuis gezamenlijke werkplek

## Navigatie en dossier

`/seinhuis/reishuis/boekingen/?id=<Sanity-id>` is een echte dossierpagina.
Het gedeelde hoofdmenu blijft op desktop links beschikbaar; mobiel is het via
Menu uitklapbaar. Hotels gebruiken hetzelfde menu en een overzichtkolom naast
het detail. Oude `?booking=`-links openen de nieuwe dossierpagina.
Het betalingsstoplicht staat ook in het dossier. Todo's blijven compact met
partnerreferentie en uitklapbare details.

## Hotels en financiële vergelijking

De hotellanding toont standaard drie instelbare rijen met maximaal vijf kaarten:
meest geboekt, meest geboekt in CH en dossiers met het grootste aantoonbare
prijsverschil. Type en land zijn per rij instelbaar. Filter, sortering, periode
en rijen worden per aangemelde medewerker in Postgres opgeslagen.
De standaardperiode omvat aankomende en lopende verblijven. Eerdere verblijven
zijn apart selecteerbaar. Hotelboekingen/aantallen komen van afgevinkte hotel-
todo's, inclusief lokale overrides. Geannuleerde boekingen zijn doorgestreept;
geboekte onderdelen van geannuleerde of op klantreactie wachtende reizen krijgen
een waarschuwing. Besparingskandidaten bevatten ook nog te boeken hotelonderdelen;
de kaarten benoemen dat en houden geen rekening met annuleringskosten.

Calculatie en werkelijke kosten komen uitsluitend uit de uniek gekoppelde
financiële regel. Actuele kosten komen van dezelfde kamer/verblijfsdata/aantallen
en de huidige prijskalender. Contracttarieven blijven in bronvolgorde: het eerste
geldige tarief wint. Ontbrekend/niet beschikbaar betekent nooit nul euro.

Maaltijden moeten gelijk zijn. Een oorspronkelijke boeking zonder ontbijt
wordt met een kamerprijs zonder ontbijt vergeleken. Reeds inbegrepen ontbijt
wordt niet opnieuw opgeteld. Bij een oorspronkelijke boeking met ontbijt en een
actueel APO-tarief zonder ontbijt wordt `apoBreakfastPrice` toegevoegd:
**per persoon per nacht** (bevestigd door gebruiker). Het aantal reizigers kan
alleen worden gebruikt als er geen overlappende hotelonderdelen zijn; anders
is een expliciet werkelijk aantal ontbijtgasten nodig. Kamercapaciteit is geen
bewijs van werkelijke bezetting. Onduidelijke maaltijdkeuze, bezetting of toeslag
wordt 'Niet vergelijkbaar', met reden. Zo'n verblijf levert geen besparing op.
Expliciete maaltijdkeuze in de oorspronkelijke regel gaat voor de hotelstandaard.

Land komt van een expliciete landcode/landnaam of herkenbare landprefix in het
adres, bijvoorbeeld `CH 3800`. Er wordt geen land uit een plaatsnaam geraden.

## Niet gekoppeld

`/hotels/?view=unlinked` toont actieve hotelonderdelen zonder unieke koppeling
op korte/lange naam of bestaande expliciete koppeling. De medewerker kiest het
hotel. Alleen `dossiers[booking].hotelLinks[todo]` wordt lokaal opgeslagen.
Een financiële regel wordt daarna nog steeds onafhankelijk op unieke naam,
kamer en datums gecontroleerd. Onopgeloste financiële ambiguïteit blijft bestaan.
De bronversie en Postgres-revisie moeten bij opslaan overeenkomen; de actie krijgt
medewerker, tijdstip en onderwerp in de historie. Geen Sanity-schrijfverzoek.

## Reisschema en documenten

Reishuis en reisschemamaker gebruiken `reisschema-summary.mjs` voor dezelfde
verrijkte registergegevens en `reisschema-table.mjs` voor dezelfde tabelinhoud,
inclusief gewijzigde tijden, meldingen en controle-informatie. Reishuis toont
de tabel alleen-lezen. Dossiernummers worden canoniek gecontroleerd, inclusief
de A-variant; meerdere Sanity-boekingen met hetzelfde nummer blijven ambigu.
Gekoppelde Google-documenten bieden de bestaande PDF-downloadmogelijkheid.
Brieven blijven via de bestaande geautoriseerde documentroute beschikbaar.

Boekjesmaker levert via een bestaande interne Railway-verbinding een minimale
lijst titel/id voor exact `sanityBooking.id`. Verwijderde boekjes en inhoud komen
niet mee. Reishuis maakt vaste links naar de bestaande boekjesmaker. Beide
services moeten deze versie draaien; zonder bereikbaar endpoint staat er dat
boekjes tijdelijk niet beschikbaar zijn, geen onterecht 'geen boekje'.

## Prestaties en toegang

Bestaande gedeelde Postgres-snapshots blijven leidend; een dossier wordt pas bij
openen geladen. De hoteldashboardberekening wordt hergebruikt zolang bronversie,
lokale revisie, tariefversie, Amsterdamse datum en periode gelijk zijn. Resources
worden maximaal 15 seconden per boeking/ambiguïteitsset hergebruikt, maximaal 64
items; gelijktijdige verzoeken delen een ophaalactie. Het verrijkte reisschema-
overzicht heeft een gedeelde cache van 10 seconden en wordt na wijzigingen in
de maker ongeldig gemaakt. Brieven en boekjesmetadata starten gelijktijdig.
Dit verandert de bestaande geplande tariefsynchronisatie niet. Catalogusformaat
4 zorgt eenmalig voor een alleen-lezen herimport van de nieuwe hotelvelden.

Alle nieuwe HTML-, module- en API-routes vallen onder de bestaande expliciete
Reishuis-rol, same-origin-beperking en private/no-store-headers. Lokale wijzigingen
vereisen sessiegebonden CSRF en optimistische revisiecontrole. De Booklets-
gatewaycredential blijft uitsluitend op de server en gaat alleen naar de vaste
interne Railway-host; redirects worden geweigerd en het antwoord is begrensd.
Bij ingetrokken toegang worden zichtbare gegevens gewist. Sanity blijft technisch
alleen-lezen in deze codepaden. Tests en screenshots gebruiken fictieve gegevens.

## Verificatie en uitrol

Voer `npm run check` uit met de geïnstalleerde Playwright-browser, plus de Python-
Booklets-tests. Gerichte tests staan in `reishuis-comparison.test.mjs`,
`reishuis-hotel-dashboard.test.mjs`, `reishuis-workspace-security.test.mjs`,
`reishuis-booklets.test.mjs`, `booklets/test_book_links.py` en
`test-reishuis-shared-workspace-browser.mjs`. De bestaande dossier-, hotel-,
Rinkel- en reisschemamakerbrowsertests blijven regressiecontroles.
Werk via PR en groene CI. Handmatige uitrol: Booklets (achterwaarts compatibele
leesroute), daarna hoofdapp. Verifieer beide deploymentstatussen en beveiligde
live routes; gebruik geen klantmutaties voor productiecontrole.


## Compacte werkplek en snelheid (vervolg op #155)

Alle pagina's gebruiken nu dezelfde door `reishuis-shell.js` gemaakte kopbalk,
met dezelfde groene achtergrond, ingelogde gebruiker en actiezone. Boekingen
gebruiken dezelfde kolomopzet als Hotels; de todo gebruikt de volledige resterende
schermhoogte. Oude vaste offsets uit de vroegere popup worden overschreven.
Filters openen via een knop. Hotelrijen tonen vijf kaarten tegelijk met horizontaal
scrollen en pijlen naar de overige resultaten. De compacte typografie en taakregels
hebben minder witruimte en geen algemene zware vetdruk.

De hotellijst en dashboarddata starten parallel. Een laadmelding vervangt het
oude lege selectiescherm. Een later dashboardantwoord mag een inmiddels gekozen
hotel niet overschrijven; de browsertest vertraagt dit antwoord bewust.
De hotelnaamindex wordt eenmaal opgebouwd per berekeningspassage en naamresultaten
worden hergebruikt. Ranking en besparingen delen één matching-/prijspassage voor
de standaardperiode. Een lokale proef met 500 fictieve hotels en 1.000 boekingen
mat circa 1.566 ms vóór en 42 ms na de wijziging voor een verse dashboardberekening.
Dit is een lokale rekenmeting, geen garantie voor netwerk- of live laadtijden.

Koppeling herkent unieke korte/lange namen met administratieve annotaties zoals
[T] en {CHECK PRIJS}, het generieke woord Hotel en de expliciete plaatsvarianten
Budapest/Boedapest en Vienna/Wenen/Wien. Dubbele passende namen blijven ambigu.
De minimale bronindex leest nu ook tags en titels van overige todo's, zonder
omschrijvingen of notities. Alleen taken die expliciet hotel zijn of uniek bij een
hotelnaam passen komen in het hoteloverzicht; overige taken worden geen hotels.
Alle bronophaling blijft GET/alleen-lezen. Geen productiedossier wordt voor een
test gewijzigd.

Besparingen zijn uitsluitend voor aankomende reizen en toekomstige hoteldata,
onafhankelijk van een eventueel historisch hotelfilter. De kaart benoemt plaats,
verblijfsperiode en voordeel. Oude/nieuwe prijs en 'hotelonderdelen' staan niet meer
op de kaart. Ontbijt, beschikbaarheid en financiële ambiguïteit blijven gecontroleerd.
