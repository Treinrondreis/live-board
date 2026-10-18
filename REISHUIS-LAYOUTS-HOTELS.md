# Reishuis layouts en hotelinformatie

Weergave links wisselt tussen dashboardpanelen en de boekingenwerkplek. De voorkeur is alleen een niet-persoonlijke browserinstelling, geen klantgegevensopslag. De werkplek laat het dossier naast de lijst zien; bij wisselen van dossier wordt sluiten bevestigd. Op smalle schermen vult het dossier het scherm.

Todo’s tonen compacte regels, voortgang en een filter voor open taken. Statuswijzigingen blijven uitsluitend in de bestaande Reishuis-opslag.

Hotels worden via de bestaande Sanity Viewer-verbinding uitsluitend met GET gelezen, met vaste project/dataset en veldprojectie. Geen boekingen, geheime instellingen of APO-jobhistorie in deze projectie. De productiecatalogus wordt lokaal in Postgres bewaard en gedeeld tussen gebruikers, ook na herstart. Om 08:15, 12:15 en 15:15 (Europe/Amsterdam) worden gewijzigde brondocumenten gecontroleerd. De vijfminutencache is uitsluitend een fixture/testadapter. Tijdens verversen blijft de vorige volledige snapshot beschikbaar. Dit start de Automatische Prijs Ophaler niet en boekt niets.

Hotelgegevens, kamers, omschrijvingen, foto’s en bestaande APO-dagtarieven zijn achter dezelfde expliciete Reishuis-rol beschermd. Foto’s gaan via de beschermde proxy met CDN-host/padcontrole en bestaande groottelimieten. Alle routes gebruiken private/no-store, same-origin en de bestaande privacyheaders. APO-koppelingen worden op document-ID en kamerkey gevolgd; ontbrekende koppelingen worden zichtbaar gemeld. Prijzen tonen bron, maaltijdtype en laatste ophaaldatum; ontbrekende datums/prijzen worden niet ingevuld of als nul voorgesteld.

Er is geen Sanity-schrijfroute toegevoegd. Geen nieuwe externe diensten, secrets of rollen. Layouts bieden bestaande functies; fictieve statistieken uit ontwerpvoorbeelden zijn niet overgenomen.

Verificatie: synthetische unit- en browsertests voor GET-paginering/conceptvoorrang, foto-validatie, rolweigering, beperkte lijstprojectie, APO-koppelingen, layoutvoorkeur na herladen, werkplek-dossier, compacte taken, mobiele kalender en wissen bij ingetrokken toegang. Bestaande dossier- en Rinkel-browsercontroles blijven onderdeel van de suite.

## Contracttarieven en effectieve prijskalender
De hotelpagina heeft per opgeslagen kamer een prijskalender met maandkeuze en vorige/volgende maand. Deze gebruikt exact dezelfde serverfunctie als de todo-herberekening, per kamer per nacht. De ingestelde boekingsprijsbron bepaalt contract (cms) of APO; de kalender gebruikt bewust de boekingsbron zodat bedragen aansluiten op Herberekenen. Een eventueel andere Sanity-calendarPriceSource wordt bewaard, maar hier niet gebruikt. Ruwe APO-brongegevens blijven apart uitklapbaar.

Contractregels blijven in hun oorspronkelijke Sanity-volgorde. Per nacht wordt de eerste regel gekozen waarvan minstens één periode past; begin- en einddatum zijn inclusief. Ontbrekende grenzen zijn open; ontbrekende/lege periodes of weekdagen betekenen alle datums/dagen. Weekdag 0 is zondag, 6 zaterdag. Er wordt niet op bedrag gesorteerd en niet gemiddeld. De kalender toont het regelnummer. De eerste passende regel met nul/ongeldig bedrag blokkeert automatisch prijzen; er wordt niet verder gezocht naar een lagere regel. Zonder passend contracttarief is handmatige invoer nodig, ook als APO een bedrag heeft. Check-out telt niet als nacht.

Catalogusformaat 3 haalt eenmalig de volledige periode- en weekdagregels en prijsbron opnieuw op, ook bij ongewijzigde _updatedAt. Bij mislukte migratie blijven hotelgegevens leesbaar, maar automatische prijzen geblokkeerd totdat de volledige regels beschikbaar zijn. Daarna geldt de bestaande incrementele planning. Lezen van de kalender start geen APO-ophaalactie en schrijft niets aan boekingen of Sanity.

GET /api/hotel-calendar (id, room, month en alleen voor APO provider/board) valt onder de bestaande expliciete rol, same-origin en private/no-store headers. Geen boekings- of persoonsinformatie in het antwoord. De gedeelde reishuis-hotel-pricing.mjs is een servermodule, geen publiek bestand. Tests gebruiken uitsluitend fictieve hotels/prijzen en controleren regelvolgorde, weekdagen, grenzen, schrikkeljaar, blokkades, kalender/herberekening-gelijkheid, migratie, mobiele bediening en ingetrokken toegang.
