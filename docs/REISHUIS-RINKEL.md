# Rinkel: inkomende oproep bij het klantdossier

Onderzocht op 17 oktober 2026. Gewenste eerste toepassing: bij een inkomende
oproep het passende Reishuis-dossier tonen. Dit document is onderzoek en ontwerp;
er is nog geen Rinkel-koppeling, webhook of nieuwe publieke route geactiveerd.

## Bevestigde mogelijkheden

- De [integratiepagina](https://www.rinkel.com/nl-nl/integraties/) en de actuele
  [kennisbank](https://faq.rinkel.com/nl/articles/17504767-hoe-koppel-ik-rinkel-aan-mijn-eigen-software-crm-helpdesk)
  noemen API en webhooks voor Professional en Expert.
- De [webhookhandleiding](https://developers.rinkel.com/docs/tutorials/webhooks)
  beschrijft incoming call met een gespreks-ID, tijdstip en van/naar-nummer in E.164.
  Het nummer kan `anonymous` zijn. Andere events zijn outgoing call, call start,
  call end en call insights. Voor de gevraagde toepassing is incoming call voldoende.
- De [REST API](https://developers.rinkel.com/docs/api/rinkel-api) gebruikt een
  Bearer API key. De oude `x-rinkel-api-key` header is legacy.
- [Webhook subscriptions](https://developers.rinkel.com/docs/api/subscribe-to-a-webhook)
  zijn configureerbaar via de API, of via My Rinkel. De ontvangende URL moet HTTPS
  gebruiken en bereikbaar zijn voor Rinkel.
- De technische webhookhandleiding bevat verouderde/tegenstrijdige informatie:
  alleen Expert versus de actuele twee abonnementen, 5 seconden responstijd
  versus 2 seconden bij retry. Bevestig dit in het account; ontwerp verwerking
  in ieder geval voor een snelle duurzame bevestiging binnen 2 seconden.

## Gewenst gedrag in Reishuis

1. Een geverifieerd incoming-call-event wordt minimaal en tijdelijk opgeslagen:
   gespreks-ID, tijdstip en telefoonnummers, zonder audio of transcriptie.
2. Alleen een aangemelde medewerker met expliciete Reishuis-rol ziet de melding.
   Er komen geen browsernotificaties buiten de beveiligde app.
3. Zoek het nummer met canonieke E.164-vergelijking. Gebruik het contactnummer
   van de boeker, niet automatisch een noodcontact. Locale nummers vereisen een
   bekende landcontext; onbekende/ongeldige nummers worden niet geraden.
4. Eén betrouwbare match: toon het dossier als de medewerker niet in een formulier
   werkt. Tijdens bewerken: toon een melding met een knop om het dossier te openen,
   zodat onopgeslagen invoer intact blijft.
5. Meerdere matches of meerdere boekingen voor dezelfde klant: toon een keuze.
   Gebruik naam/nummer alleen nooit als bewijs om klanten automatisch samen te voegen.
   Geen match of anoniem: toon de oproepmelding zonder een willekeurig dossier.
6. Sluiten van de app of intrekken van toegang stopt de weergave. Duplicaten,
   oude events en events buiten de ingestelde bedrijfsnummers worden genegeerd.

## Benodigde verificatie vóór implementatie/activering

- Toegang tot het bestaande Rinkel-account, het abonnement en de bedrijfsnummers.
  In de beschikbare browsersessie verscheen de inlogpagina; de gebruiker is gevraagd
  zelf in te loggen. Er is geen API-key gelezen, aangemaakt of gewijzigd.
- De officiële gelezen pagina's bevestigen niet hoe een callback cryptografisch
  wordt ondertekend of welke aangepaste authenticatieheaders ondersteund worden.
  Verifieer de werkelijke subscriptionvelden en callback-authenticatie vóór een
  ontvanger te publiceren. Alleen een publieke URL en een bron-IP zijn geen voldoende
  bewijs van authenticiteit. Geheimen horen niet in querystrings, browsercode of logs.
- De huidige snelle dashboardprojectie bevat bewust geen telefoonnummers. Dossiers
  worden op aanvraag gelezen. Voor volledige herkenning is een afzonderlijke,
  minimale en beschermde telefoonindex nodig, met lokale contactwijzigingen als
  voorrang. Alleen reeds geopende dossiers doorzoeken zou onvolledig zijn.
- Account- en medewerkersrouting moeten duidelijk zijn: incoming call bevat geen
  betrouwbare ontvanger-gebruiker zoals call start dat kan bevatten. Er mag dus niet
  worden beweerd dat alleen de daadwerkelijke opnemende medewerker wordt bereikt.
- Leg een korte bewaartermijn voor meldingen vast, dedupliceer op gespreks-ID en
  eventtype en verwerk privégesprekken niet buiten de gekozen bedrijfsnummers.
- Nieuwe leesroutes blijven achter de expliciete Reishuis-rol met private/no-store,
  same-origin en no-referrer. Een eventuele machine-callback krijgt een afzonderlijke
  gecontroleerde authenticatiegrens; geen medewerkers- of owner-bypass toevoegen.
- Geen Sanity-schrijfacties, Rinkel-contactexport, opnames, AI-insights, telefoontjes
  of berichten nodig voor deze eerste toepassing. Een proefoproep wordt door de
  gebruiker gedaan nadat de concrete ontvangstconfiguratie is gecontroleerd.

Een API-key of webhook activeren verruimt toegang tot telefoongegevens. Bereid de
concrete instellingen voor en laat de gebruiker de exacte nieuwe verbinding
goedkeuren voordat die wordt geactiveerd. Vraag nooit een sleutel in de chat te plakken.
