# Reishuis layouts en hotelinformatie

Weergave links wisselt tussen dashboardpanelen en de boekingenwerkplek. De voorkeur is alleen een niet-persoonlijke browserinstelling, geen klantgegevensopslag. De werkplek laat het dossier naast de lijst zien; bij wisselen van dossier wordt sluiten bevestigd. Op smalle schermen vult het dossier het scherm.

Todo’s tonen compacte regels, voortgang en een filter voor open taken. Statuswijzigingen blijven uitsluitend in de bestaande Reishuis-opslag.

Hotels worden via de bestaande Sanity Viewer-verbinding uitsluitend met GET gelezen, met vaste project/dataset en veldprojectie. Geen boekingen, geheime instellingen of APO-jobhistorie in deze projectie. Een volledige hotelsnapshot wordt vijf minuten in servergeheugen gedeeld; na herstart is een nieuwe leesronde nodig. Tijdens verversen blijft de vorige volledige snapshot beschikbaar. Dit start de Automatische Prijs Ophaler niet en boekt niets.

Hotelgegevens, kamers, omschrijvingen, foto’s en bestaande APO-dagtarieven zijn achter dezelfde expliciete Reishuis-rol beschermd. Foto’s gaan via de beschermde proxy met CDN-host/padcontrole en bestaande groottelimieten. Alle routes gebruiken private/no-store, same-origin en de bestaande privacyheaders. APO-koppelingen worden op document-ID en kamerkey gevolgd; ontbrekende koppelingen worden zichtbaar gemeld. Prijzen tonen bron, maaltijdtype en laatste ophaaldatum; ontbrekende datums/prijzen worden niet ingevuld of als nul voorgesteld.

Er is geen Sanity-schrijfroute toegevoegd. Geen nieuwe externe diensten, secrets of rollen. Layouts bieden bestaande functies; fictieve statistieken uit ontwerpvoorbeelden zijn niet overgenomen.

Verificatie: synthetische unit- en browsertests voor GET-paginering/conceptvoorrang, foto-validatie, rolweigering, beperkte lijstprojectie, APO-koppelingen, layoutvoorkeur na herladen, werkplek-dossier, compacte taken, mobiele kalender en wissen bij ingetrokken toegang. Bestaande dossier- en Rinkel-browsercontroles blijven onderdeel van de suite.
