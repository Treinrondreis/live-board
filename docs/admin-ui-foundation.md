# Gezamenlijke beheerhuisstijl — stap 1

Versie 1.0.0. Voor Seinhuis, Stationschef, KM-trein, Treinreiziger, Boekjesmaker en FloRA.

## Opgeleverd

De gedeelde basis staat in `public/admin-ui/`. De voorbeeldpagina is een componentencatalogus met fictieve gegevens, geen vervanging van een bestaand beheerscherm. Productiepagina's en hun routes zijn in deze stap niet aangepast. Ook rollen, rechten, opslag, leverancierscontroles en Sanity blijven buiten deze wijziging.

| Onderdeel | Afspraak |
| --- | --- |
| Merk | Blauw-groene bovenbalk; bestaande productnamen en logo's behouden |
| Typografie | Montserrat voor koppen en knoppen, Open Sans voor tekst en invoer; lokaal geladen |
| Leesbaarheid | Basis 16px; secundaire labels minimaal 14px; bediening minstens 44px hoog |
| Opbouw | Vaste bovenbalk, zijmenu op desktop, uitklapbare navigatie op mobiel, witte werkvlakken |
| Hoofdactie | Eén opvallende blauwe knop per werkvlak; rustige nevenacties |
| Status | Rood: concrete afwijking. Oranje: beoordeling nodig. Groen: controle geslaagd. Altijd een tekstlabel |
| Formulieren | Zichtbare labels, hulptekst, fouttekst verbonden via `aria-describedby`, `aria-invalid` bij fouten |
| Tabellen | Leesbare rijen; compacte variant beschikbaar; alleen de tabel schuift horizontaal |
| Toegankelijkheid | Zichtbare toetsenbordfocus, springlink, terugkeer van focus bij sluiten van mobiel menu, verminderde beweging |
| Foto | Grote fotokop hoort bij een startpagina; de concrete proefpagina volgt in stap 2 |

De kleurverloopstops zijn donker genoeg gemaakt voor witte navigatietekst. De automatische contrastcontrole eist 4,5:1 voor gewone tekst en 3:1 voor invoerranden. Dit is geen volledige toegankelijkheidsaudit van de zes toepassingen.

## Bestanden en gebruik

Laad in deze volgorde: `fonts.css`, `tokens.css`, `components.css`. Fonts en hun licenties staan in `fonts/`. Gebruik een `.tr-ui`-element als expliciete hoofdcontainer en pas de `tr-*`-componentklassen toe. De selectors veranderen geen bestaande schermen buiten die container. De demo-opmaak in `specimen.css` en het demonstratiegedrag in `specimen.js` horen niet bij de productintegratie.

Voorbeelden: `.tr-header`, `.tr-layout`, `.tr-sidebar`, `.tr-nav`, `.tr-main`, `.tr-card`, `.tr-button`, `.tr-field`, `.tr-toolbar`, `.tr-table`, `.tr-badge`, `.tr-notice`, `.tr-empty` en `.tr-stat`. Varianten staan in de componentencatalogus.

De bibliotheek bevat geen verplicht framework, geen externe diensten en geen algemene overschrijvingen van bestaande knop- of tabelstijlen. Andere services, zoals Boekjesmaker, kunnen de beoordeelde versie als statische bestanden overnemen. Daarmee is hun vormgeving nog niet automatisch gesynchroniseerd; dat vereist een expliciete integratie in een latere stap.

## Voorbeeld lokaal openen

Met Node 24: `node scripts/preview-admin-ui.mjs`. Open de getoonde lokale URL. De server luistert alleen op de lokale computer en bedient uitsluitend bestanden uit de voorbeeldmap. Met `PORT` kan een andere poort worden gekozen.

De navigatielinks in de catalogus springen naar componentvoorbeelden. In productie moet de navigatie aansluiten op de bestaande servercontrole van rollen en toegestane onderdelen; een verborgen menu-item is geen toegangsbeveiliging.

## Controle en gegevensbescherming

- `node --test admin-ui.test.mjs`: tekstcontrast, invoerranden, afgeschermde statische preview en weigeren van schrijfacties.
- `node test-admin-ui-browser.mjs`: zoeken en filteren, toetsenbord, focusherstel, mobiele navigatie bij 850/390/320px, geïsoleerde selectors en uitsluitend lokale GET-verzoeken.
- Bestaande centrale `npm run check` neemt beide nieuwe testbestanden mee.
- Met `ADMIN_UI_SCREENSHOTS` kan de browsertest schermafbeeldingen buiten de repository bewaren.

Technisch actief in de voorbeeldpagina: uitsluitend lokale assets, een CSP die netwerkverbindingen en formulierverzending blokkeert, geen API-aanroepen, opslag of cookies en fictieve voorbeeldgegevens. Deze wijzigingen activeren geen nieuwe beveiliging in bestaande toepassingen. De Sanity-toestemmingsafspraak blijft een werkinstructie; deze bibliotheek beheert geen Sanity-rechten.

## Volgende stappen

Stap 2 maakt twee concrete proefpagina's met deze basis: Seinhuis en één FloRA-werkpagina. Pas na beoordeling daarvan volgt productie-integratie. In deze PR zijn daarom geen bestaande schermen omgezet en geen productie-uitrol of configuratiewijzigingen opgenomen.
