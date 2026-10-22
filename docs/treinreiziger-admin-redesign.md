# Treinreiziger-beheer in de gezamenlijke huisstijl

Eerste concrete toepassing van de gedeelde stijlbasis, op verzoek van de gebruiker.

## Schermen en routes

- `/seinhuis/treinreiziger` opent het nieuwe overzicht.
- `/seinhuis/paginas` blijft de bestaande editoringang en opent Pagina’s.
- Het linkermenu bevat Overzicht, Pagina’s, Appnavigatie, Feeds en bronnen en een link naar de openbare app.
- Onder ‘Andere onderdelen’ in de zijbalk staan alleen toepassingen waarvoor de ingelogde gebruiker bestaande rechten heeft. Treinreiziger is als huidig onderdeel gemarkeerd.
- Pagina’s, onderste appnavigatie, feeds en bronnen worden in hetzelfde bestaande concept bewaard. Wisselen tussen de schermen slaat niets op en verwijdert geen bewerkingen.
- Feeds en bronnen is een overzicht van feedonderdelen in het concept. Bewerken gebeurt op de bijbehorende app-pagina; er is geen nieuw gegevensmodel voor feeds toegevoegd.

## Behouden gedrag

De werkruimte volgt de goedgekeurde Boekjesmaker-stijl: een effen zijbalk, warme achtergrond, systeemlettertype en rustige knoppen. Treinreiziger krijgt rood `#bd2131`, gelijk aan de bestaande Seinhuis-inlogknop. De kleurdefinities voor Kilometer Kampioen (hetzelfde rood) en Stationschef (turquoise `#267789`) staan klaar in `public/admin-ui/module-colors.css`; die onderdelen worden pas bij hun eigen omzetting aangesloten. Boekjesmaker en FloRA laden deze bestanden niet en behouden hun bestaande stijl.

Concept opslaan, conceptvoorbeeld, publiceren, herstellen van de vorige publicatie, paginabeheer, menulinks, feedonderdelen, eigen inhoud en weergavekeuzes blijven beschikbaar. Het conceptvoorbeeld slaat, zoals voorheen, eerst het concept op. Publicatie vereist dezelfde bestaande API-actie. De openbare app, haar opmaak, persoonlijke stations, filters en dienstregelingsfuncties zijn niet herontworpen.

De gedeelde basis wordt geladen vanaf `/admin-ui/`. De adapter `app-cms-admin.css` staat los van `/app/cms.css`, zodat de openbare appweergave ongewijzigd blijft. De bestaande statische bestandsserver krijgt alleen het correcte MIME-type voor WOFF2 erbij.

## Toegang en gegevensstromen

Technisch behouden: servercontrole met scope `treinreiziger`, afgeschermde concept- en editorroutes, bestaande same-origincontrole voor schrijven, revisiecontrole tegen overschrijven en de bestaande feed-allowlist. Het hoofdmenu gebruikt dezelfde servercontrole van toegestane toepassingen; het menu verleent geen rechten. De nieuwe module-ingang wordt door dezelfde CMS-handler gecontroleerd als de oude editoringang.

De nieuwe opmaak en navigatie schrijven niet zelfstandig naar opslag. Alleen bestaande gebruikersacties gebruiken de bestaande app-content-API. Er zijn geen Sanity-koppelingen of Sanity-wijzigingen toegevoegd. De vaste toestemmingseis voor Sanity blijft een werkinstructie; deze wijziging beheert geen Sanity-rechten.

## Controle

- Bestaande CMS-tests: validatie, privacy van concepten, publiceren en vorige versie, revisieconflicten, authenticatie, same-origincontrole en feed-allowlist.
- Nieuwe routecontroles voor beide beheer-ingangen en de afgeschermde adapter.
- `admin-ui-navigation.test.mjs`: zichtbare toepassingen volgen de bestaande scopecontrole.
- `test-cms-admin-browser.mjs`: schermwissels zonder gegevensverlies, navigatie bewerken, opslaan, feedoverzicht, conceptvoorbeeld, publiceren, herstellen, revisieconflict en toetsenbord/mobiele bediening bij 850/390/320px.
- De browsertest werkt uitsluitend met fictieve inhoud, een in-memorydatabase en een lokale testserver; externe verzoeken worden geblokkeerd.

## Lokaal beoordelen

`npm run preview:treinreiziger-admin` start een uitsluitend lokaal toegankelijke testomgeving met een tijdelijke database. De daar uitgevoerde acties raken alleen fictieve inhoud en verdwijnen bij stoppen van de preview. Deze testhelper wordt niet door de productieserver geladen en omzeilt daar geen authenticatie.

Er is in deze wijziging geen automatische productie-uitrol opgenomen. De overige toepassingen behouden hun bestaande schermen.
