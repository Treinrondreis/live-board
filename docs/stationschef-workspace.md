# Stationschef in de beheerhuisstijl

Stationschef volgt de gekozen Boekjesmaker-stijl met een turquoise zijbalk (`#267789`), warme achtergrond en systeemlettertype. De eigen modulekleur komt uit `public/admin-ui/module-colors.css`.

## Omgezet

- `/stationschef`: overzicht met vier ingangen.
- `/stationschef/treinbord`: grote treinbord en schermkopieën.
- `/stationschef/borden`: vertrekborden, stations, filters en vormgeving.
- `/stationschef/aansluitingen`: aansluitingen en uitzonderingen.
- `/stationschef/perrons`: spoorindeling en overstaptijden.

De bestaande templates, formulier-ID’s, bewerkingsscripts en API's blijven behouden. `stationschef-layout.mjs` voegt uitsluitend een gemeenschappelijke navigatie toe aan afgeschermde beheerroutes. De links onder Andere onderdelen volgen de bestaande serverrechten. Mobiel is de navigatie via Menu bereikbaar, ook na scrollen; Escape sluit het menu en herstelt de focus.

Openbare vertrekborden, het grote publieke scherm, aansluitarchief, dagverslagen, inlogschermen en andere beheeronderdelen zijn niet herontworpen. Hun bestaande links blijven beschikbaar. Geen gegevensmigratie, nieuwe opslagactie of Sanity-wijziging.

## Controle

`test-stationschef-browser.mjs` doorloopt de vijf views met fictieve inhoud en opslag in een tijdelijke testomgeving. Controleert bestaande opslagknoppen, het actieve menu, één main-landmark, schermbreedtes 1440/1024/850/390/320px en het mobiele menu na scrollen. De fixture bindt alleen op loopback en start geen productietaken. Screenshots kunnen buiten de repository worden opgeslagen met `STATIONSCHEF_SCREENSHOTS`.

De bestaande unitcontroles blijven verantwoordelijk voor de inhoudelijke validatie, oorsprongcontrole en revisiebeveiliging van de API's. De nieuwe stijl voert geen opslagacties uit. De Sanity-toestemmingsgrens is een vaste werkinstructie; deze wijziging past geen rechten aan.
