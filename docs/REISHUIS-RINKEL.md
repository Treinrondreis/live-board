# Rinkel: inkomende oproep bij het klantdossier

Onderzocht op 17 oktober 2026. Gewenste eerste toepassing: bij een inkomende
oproep het passende Reishuis-dossier tonen. Het ontwerp is inmiddels voorbereid in code. De ontvangst blijft standaard uit totdat de concrete verbinding apart is goedgekeurd en geconfigureerd.

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

## Voorbereide implementatie

Accountinspectie bevestigt de inkomende-oproepinstelling. Het accountformulier biedt
alleen URL, content-type en omschrijving; geen aparte authenticatieheader. Voor deze
screen-pop is geen Rinkel API-key nodig en wordt geen REST-leesrecht gevraagd.
De zakelijke lijnen Treinrondreis.nl en Spoedlijn zijn als voorgestelde scope bekeken;
het derde nummer wordt niet automatisch aangesloten. Er is nog niets opgeslagen in
Rinkel en er zijn nog geen productievariabelen voor de koppeling gezet.

`createRinkelIncoming` staat uit zonder alle drie de instellingen:
`RINKEL_INCOMING_ENABLED=1`, een willekeurige 64-hex `RINKEL_WEBHOOK_SECRET` en een
E.164-lijst `RINKEL_ALLOWED_NUMBERS`. Een apart machinepad
`/integrations/rinkel/incoming/<secret>` accepteert uitsluitend kleine JSON POSTs.
Dit onraadbare geheime pad is de webhook-authenticator omdat Rinkel in de getoonde
UI geen headerinstelling aanbiedt. De URL is een credential: alleen in de beschermde
Rinkel- en Railway-instellingen gebruiken, nooit delen in chat, Git, CI, browsercode
of screenshots. De applicatie logt verzoekpaden/payloads niet. Hosting- en provider
accesslogs kunnen de volledige URL bevatten en moeten als geheim materiaal worden
behandeld. Er wordt geen claim gedaan dat Rinkel een payloadsignature levert.

Uitgeschakeld/verkeerd geheim geeft 404 vóór gegevensverwerking. Browser-Origin en
Fetch-Metadata worden geweigerd. Gekozen bestemmingsnummer, tijdvenster, formaat,
4 KB requestlimiet, deduplicatie en geheugengrenzen worden gecontroleerd. Call notices
bestaan alleen in process memory, maximaal 100 actief, zichtbaar voor 30 minuten.
De tijdelijke deduplicatieset is maximaal 1000 IDs en wordt na 10 minuten bij een
volgende verwerking opgeschoond. Geen call history, audio, samenvattingen of rauwe
bellertelefoonnummers worden opgeslagen. Herstart wist meldingen. Huidige productie
heeft één replica; meerdere replicas vereisen een gedeelde eventbus voordat dit
betrouwbaar gebruikt kan worden.

Een aparte minimale, gepagineerde Sanity GET leest uitsluitend `_id,phone,country`.
Deze leesactie start pas bij een geautoriseerde Reishuis-poll wanneer de koppeling
is ingeschakeld. De index blijft server-side in geheugen als HMAC-telefoondigests;
geen export naar Rinkel en geen ruwe telefoonindex in browser/Postgres/Git.
E.164 en bekende landcontexten worden ondersteund; onbekende locale formaten worden
niet geraden. Geen suffix-match en geen match op noodcontacten. Lokale contactvelden
met expliciete telefoonwijziging gaan voor de bron; leeg lokaal telefoonveld sluit
het oude bronnummer uit. De index ververst na vijf minuten op aanvraag. Bij een
mislukte verversing wordt herkenning geblokkeerd totdat lezen weer lukt.

De geauthenticeerde `/seinhuis/reishuis/api/rinkel` poll en JS-module gebruiken de
bestaande expliciete rol, same-origin-controle en privacyheaders. De browser ontvangt
alleen minimale passende boekingsreferenties. Eén exacte match opent automatisch
alleen als geen editor, dossier, voorkeuren of klantpaneel geopend is en de pagina
zichtbaar is. Tijdens bewerken verschijnt een melding binnen het bestaande dialoog;
de gebruiker kiest zelf om over te stappen. Meerdere gelijktijdige oproepen of
meerdere matches worden nooit automatisch gekozen. Meldingen worden gewist zodra
toegang verloopt of ingetrokken is. Er is geen browser-persistente opslag.

Automatische tests gebruiken uitsluitend fictieve nummers, records en events. De
live Rinkel URL-test gebruikt oud voorbeeldmateriaal; de ontvanger bevestigt de
transporttest maar negeert zo'n verouderd event. Een echte nieuwe oproep moet daarom
apart met de gebruiker worden gecontroleerd voor een volledige praktijkverificatie.

## Openen na het opnemen

Bij openen of F5 krijgt een geautoriseerde sessie ook de nog aanwezige oproepen
van de laatste dertig minuten. Deze staan als recente oproep met dossierkeuze;
ze openen nooit automatisch een dossier. Indexopbouw bewaart deze eerste selectie
tot de herkenning klaar is. Volgende polls tonen alleen nieuwe oproepen. Dezelfde
rolcontrole, maximale bewaartermijn en geheugenopslag blijven van toepassing;
herstart wist meldingen.

## Handmatig koppelen en extra herkenning

De recente meldingen blijven maximaal dertig minuten in begrensd procesgeheugen.
De payload blijft alleen maximaal twee minuten oud geaccepteerd. Een medewerker
kiest expliciet een dossier en bevestigt de koppeling. Alleen gespreks-ID, datum,
boeking en koppeldatum worden dan in de bestaande private Postgres-state bewaard.
Een optioneel extra herkenningsnummer wordt als HMAC en laatste vier cijfers
opgeslagen, zonder het bestaande bronnummer te vervangen. Het wordt ook gebruikt
voor boekingen die expliciet aan dezelfde eigen klant gekoppeld zijn. Een
herkenningsconflict of bestaand gesprek bij een ander dossier wordt geweigerd.
Extra herkenning kan apart verwijderd worden; de gesprekskoppeling blijft staan.
Rotatie van het webhookgeheim maakt bestaande herkenningshashes ongeldig.
Alle nieuwe routes gebruiken de bestaande rol, same-origin, CSRF en revisiecontrole.
Geen ruwe nummers, digests of webhookgeheim in de dashboardrespons of logs.

Opnames/samenvattingen blijven nog uit: Rinkel vereist daarvoor een API-key, die
apart met expliciete toestemming wordt aangemaakt. De API biedt gespreksdetails, bestaande insights
en een tijdelijke opname-URL. Nieuwe opname- of betaalde AI-instellingen worden
niet ingeschakeld. De huidige koppeling bewaart geen audio of transcripties.

De opnamevoorbereiding gebruikt uitsluitend GET naar api.rinkel.com. Pas met
RINKEL_READ_API_KEY wordt deze actief. De browser kan alleen een reeds gekoppeld
gesprek opvragen; gespreks-ID en bedrijfsnummer worden nogmaals bij Rinkel
geverifieerd. Alleen de bestaande samenvatting en een opname-indicatie gaan terug.
De audio loopt via de rolbeveiligde Reishuis-route met private/no-store; geen
API-key of tijdelijke provider-URL in de browser. Afspelen vraagt de opname op
bij api.rinkel.com/audio/call-recording/, weigert redirects/andere hosts en heeft
een limiet van 40 MB. Samenvattingen en audio worden niet opgeslagen of naar een
andere AI-dienst gestuurd. Dit is getest met fictieve providerantwoorden; echte
providerverificatie wacht op goedgekeurde API-toegang. Historische gesprekken van
vóór de aansluiting worden nog niet geïmporteerd.

Exact één herkend dossier wordt via een geautoriseerde CSRF-beveiligde POST automatisch gekoppeld,
zonder een extra herkenningsnummer op te slaan. Bij ambiguïteit wordt niets gekozen.
Bij een opslagconflict blijft handmatig koppelen beschikbaar; bestaande koppelingen worden niet verplaatst.
De gebruiker heeft de aparte accountbrede Rinkel-sleutel expliciet goedgekeurd nadat
bleek dat het aanmaakvenster geen beperkte rechten ondersteunt. De applicatiegrens
is GET-only en twee lijnen; de sleutel zelf biedt technisch bredere accounttoegang.
