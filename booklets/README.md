# Boekjesmaker in Seinhuis

## Meerdere boekjes met één sjabloon

Via **Meerdere boekjes maken** kunnen één tot vijf boekingsnummers met één
sjabloon worden voorbereid. Bij een dubbel boekingsnummer kiest de gebruiker
eerst de juiste boeking. Voorbereiden maakt nieuwe, afzonderlijk opgeslagen
boekjes; bestaande boekjes blijven behouden. Klantwaarden, documentselecties en
persoonlijke overlays uit het sjabloon worden voor de nieuwe boeking geleegd.

De browser verwerkt de groep na elkaar via de bestaande beveiligde API’s.
Laat het scherm open tijdens het ophalen en genereren. Stoppen kan na het
huidige boekje; opgeslagen groepen zijn daarna hervatbaar via hetzelfde scherm.
Er is geen zelfstandige achtergrondwerker die doorgaat na het sluiten van de
browser. De groepsverwijzing staat bij ieder boekje op de server; klantgegevens
of sleutels worden hiervoor niet in browseropslag gezet.

Alleen gecontroleerde regels kunnen samen worden gegenereerd, met een aparte
PDF en de bestaande opslaginstelling per boeking. Ontbrekende documenten,
onbevestigde voorstellen en onbereikbare bronnen blijven voor individuele
controle staan. Een opgeslagen boekje kan worden geopend, aangepast en via
**Opslaan en terug naar groep** opnieuw worden gecontroleerd. De controles
worden vóór elke PDF opnieuw uitgevoerd. Wijzigingen van collega’s worden niet
overschreven; reeds gemaakte PDF’s van dezelfde boekversie worden bij hervatten
overgenomen. Een later gewijzigd boekje vraagt opnieuw controle en kan een nieuwe
PDF krijgen; de vorige PDF blijft bewaard. De exportlijst bevat hiervoor alleen
het revisienummer van het boekje, geen extra kopie van klantgegevens. Sanity
wordt in deze werkwijze uitsluitend gelezen.

Independent Python service, private Railway networking only. Public entry point:
`https://treinbord.up.railway.app/seinhuis/boekjesmaker/`.
The Node gateway checks the existing **owner** session on every request. KM-only
members do not gain access. All mutations require the exact public Origin and
X-Booklets header. Cookies, client authorization and arbitrary proxy headers are
never forwarded. Shared gateway secret authenticates the private service too.

## Railway setup

Use the existing repository/main, root directory `/booklets`, detected Dockerfile.
Set healthcheck `/health`, port 8080, restart on failure (5 retries) in Railway.
Do not use the root railway.json (that starts Node). New services can no longer
opt into legacy Config as Code after 2026-08-28; configure this service in the UI.
Use one replica in the same region as live-board, a dedicated volume at `/data`,
and no public domain/TCP proxy. Limits: 2 GB RAM, 1 CPU, application storage
quota (5 GB default, explicitly approved production setting: 10 GB). Railway provisioned a 50 GB volume and does not offer shrinking in this UI;
it bills used space. The app enforces the configured BOOKLETS_STORAGE_LIMIT usage in upload/render/import
paths with metadata headroom. Obtain cost agreement before raising limits. Enable daily
volume backups. No PostgreSQL schema or KM-media bucket changes are required.

Python variables:

- BOOKLETS_GATEWAY_SECRET: cryptographically random, >=32 characters.
- BOOKLETS_ENCRYPTION_KEY: Fernet key (32 random bytes, URL-safe base64).
- BOOKLETS_PUBLIC_ORIGIN: https://treinbord.up.railway.app
- BOOKLETS_DATA: /data
- PORT: 8080
- BOOKLETS_IMPORT_ENABLED: 1 during the initial import; remove afterwards.
- Optional GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: Google **web** OAuth client,
  Docs API enabled, documents.readonly. Exact authorized redirect:
  https://treinbord.up.railway.app/seinhuis/boekjesmaker/google/callback
- GEOAPIFY_API_KEY: server-only Geoapify key for location search, Dutch walking
  directions and OSM Bright static maps. Never include this key in browser URLs.
- Creating route copies in Google Docs additionally requires Drive API enabled
  and explicit OAuth consent for drive.file. Existing documents.readonly access
  continues to work without that extra grant. Copies do not sync back to routes.
- Optional BOOKLETS_VOUCHER_DRIVE_FOLDER_ID: existing hotel-voucher folder, read
  through the same Google Drive connection. Voucher search also lists matching
  booking files directly in this folder, including PDFs without "voucher" in the
  filename. General search results must explicitly identify a voucher; timelines,
  tickets and invoices are excluded. Multiple distinctly named folder vouchers
  are combined and require the existing customer/hotel/date review before export.
- Optional BOOKLETS_VOUCHER_ARCHIVE_DRIVE_FOLDER_ID: archived hotel-voucher folder.
  Matching booking files directly in this folder are searched and validated in the
  same way as the active voucher folder. Restore archived files from Drive Trash
  before moving them here; trashed files remain excluded. Duplicate filenames
  require manual selection. Files without a booking number are not auto-matched.

## Automatische voorstellen

Boekingen → Automatisch boekje voorstellen: zoek en selecteer een exacte
Sanity-boeking. Reissjablonen → Automatisch sjabloon voorstellen: beschrijf de
reis of gebruik een boeking als voorbeeld. Het voorstel blijft bewerkbaar voordat
het als concept wordt overgenomen; opslaan blijft een aparte handeling.
Sjablonen bewaren geen klantgegevens of persoonlijke documentselecties.

Bij bouwstenen en herbruikbare keuzepagina’s staat **Herkenning voor automatisch
bouwen**: rol, bestemmingen, treinen, ToDo-teksten, omschrijving, keuzegroep en
algemene standaard. Puntkomma’s scheiden alternatieven. Een volledige ToDo-tekst
moet binnen één ToDo voorkomen. Codes hebben woordgrenzen (CORA ≠ CORA2).
De lokale planner rangschikt exacte ToDo-matches, bestemmingen/treinen,
overeenkomstige woorden in de omschrijving en standaarden, in die volgorde.
Er is geen externe AI-aanroep of willekeurige selectie. Zwakke of even sterke
keuzes blijven zichtbare voorstellen. Bij hergebruik van een automatisch sjabloon
worden de toegestane alternatieven opnieuw gerangschikt voor de gekozen boeking;
een expliciete eigen keuze wordt behouden.

De bestaande paginatypes worden als rol gebruikt wanneer geen rol is ingesteld.
Alleen actieve bouwstenen van het gekozen formaat doen mee. Passende train-,
route- en bestemmingsgroepen kunnen samen in de reis komen. De boekingsplekken
voor brief, reisschema, gecombineerde treintickets en vouchers worden toegevoegd.
Tickets en vouchers worden binnen hun hoofdstuk gesorteerd. Ze staan aanvankelijk
per documentsoort bij elkaar: de documentenbak kan ze daarna over de reis verdelen.
Er worden geen reismomenten verzonnen op basis van onzekere ToDo-datums.

`/api/automatic-build` en `/api/automatic-choices` vereisen de bestaande beveiligde
sessie/gateway. Beide lezen uitsluitend de bibliotheek en schrijven niets. De
voorstelknop controleert bibliotheekrevisies opnieuw voordat een voorstel gebruikt
wordt. Laat binnengekomen resultaten worden genegeerd na wijzigen/annuleren.

## Treinscherm

Bibliotheek of persoonlijk boekje → Treinscherm. Kies heen/terug met twee
ritparen of een rondreis met twee tot zes bestemmingen. Een A4-pagina gebruikt
een staande uitsnede; A5 liggend toont een bredere uitsnede. De originele foto
van 6000 × 4002 pixels blijft ingesloten; schermvormen en Open Sans-tekst zijn
vectoren. Geen Frutiger-fontbestand wordt meegeleverd.

Bij een persoonlijk boekje kunnen al opgehaalde ticketpagina’s worden gelezen.
Alleen expliciete ritregels met gekoppelde stations en tijden worden voorgesteld.
Kies zelf de juiste heen- en terugrit en bevestig de controle. Er wordt geen
OCR of externe AI gebruikt en er worden geen ontbrekende tijden of datums
verzonnen. Datums zijn optioneel, afzonderlijk voor vertrek en aankomst.
De PDF wordt eerst als voorbeeld gemaakt; toevoegen aan het boekje en opslaan
blijven aparte handelingen. De pagina is daarna opnieuw te bewerken via
Treinscherm bewerken. Eerdere PDF-assets blijven onveranderd.

## Opmaak, documentpagina’s en drukversies

Bij een vaste PDF-bouwsteen kan de opmaak van de huidige pagina worden bewaard
en toegepast op andere bouwstenen van hetzelfde formaat. De twee ingebouwde
instellingen zijn Voorpagina (titel op fotoband) en Inhoudsopgave (Open Sans,
zwart, 25 mm links/rechts/onder). Een opmaak bewaart velddefinities en invulcodes;
geen achtergrond-PDF, bronkoppelingen of klantwaarden. Toepassen vervangt alleen
de velden van de gekozen pagina, na bevestiging, met herstel van de vorige opmaak.

Documenten wijzigen opent de documentenbak uitsluitend op verzoek. Bestaande
documenthoofdstukken kunnen worden geordend en hun pagina’s vergroot/bekeken.
Een geselecteerd deel van één document kan naar een nieuw hoofdstuk op een
gekozen positie worden verplaatst. Beide PDF-delen worden eerst gemaakt; pas
na succes en controle dat boeking/document/modal niet zijn gewijzigd wordt de
samenstelling aangepast. Bronpagina’s, datumcontroles en bronmetadata blijven
behouden. Gekoppelde Google/Sanity-bouwstenen en treinschermen worden niet gesplitst.

Bij export zijn dubbele opgenomen documentpagina’s waarschuwingen, geen blokkade.
De vergelijking gebruikt bron-PDF + paginanummer en SHA-256 van de PDF om ook
identieke uploads te herkennen. Verschillende pagina’s van één PDF gelden niet
als dubbel; niet gebruikte oorspronkelijke pagina’s tellen niet mee.

Nieuwe drukversies krijgen een korte beschrijving van herkenbare wijzigingen.
Gebruikers kunnen bij iedere export een afzonderlijke opmerking bewaren/bewerken.
De PDF zelf blijft onveranderlijk. Eerdere exports kunnen naar een prullenbak en
worden hersteld; de nieuwste actieve export is beschermd. Definitief verwijderen
is een aparte, bevestigde actie en verwijdert PDF en exportvoorbeelden. Downloads
en digitale proeven van exports in de prullenbak geven 404. Opruimen blijft mogelijk
als de applicatie-opslagquota bereikt is.

## Routemaker

Library → Routemaker. Search and explicitly select both locations, calculate the
walking route, review the static map/instructions, optionally edit text and upload
a licensed photo, then generate a PDF and save the normal library block. A4/A5,
country/destination and standard numbering are preserved. Full route geometry,
attributed maps and normalized photos live in /data/routes under random IDs;
they are private and covered by the volume backup. Generation is serialized by
the existing worker semaphore. Existing PDFs remain immutable. Reopening a route
does not call Geoapify or change its stored instructions. Map/API failures show a
sanitized message, never a URL containing the provider key. Google export only
creates new copies, reuses the recorded copy for the same PDF asset, and requires
the block to have been saved first.

live-board variables:

- BOOKLETS_INTERNAL_URL: http://<actual-private-service-name>.railway.internal:8080
- BOOKLETS_GATEWAY_SECRET: identical private gateway secret.
- BOOKLETS_PUBLIC_ORIGIN: https://treinbord.up.railway.app

Keep these in Railway variables/secrets; never commit values. Google credentials
are encrypted at rest. The old Windows-bound OAuth file cannot be migrated.
Google callback uses an explicit same-site continuation to restore the existing
Strict login cookie before processing the one-time state and PKCE code.

## Initial migration

Stop editing the local library during the final snapshot and transfer. Run:
`python prepare_import.py SOURCE_DATA OUTPUT_DIRECTORY` in a private local work
directory outside Git. It uses SQLite's backup API. Users/passwords/Google tokens
and preview caches are excluded. At the protected `/seinhuis/boekjesmaker/import`
select import.json and every .part file, then import. Checksums, file whitelist,
asset/export completeness and database transaction protect the import. Existing
nonempty libraries cannot be overwritten. Verify counts and several PDFs, remove
BOOKLETS_IMPORT_ENABLED, then create an initial volume backup. Local originals
remain untouched. Each local snapshot needs a new empty output directory.

## Resource and recovery limits

### Finished PDF exports in Google Drive

In a book, choose **PDF-opslag in Drive** and enable storage. This uses the
existing server-side Google OAuth connection with `drive.file` (the same extra
permission used for creating routes). No broad Drive-write scope or public
sharing is requested. The app creates **Treinrondreis - Reisboekjes** in the
connected account. Keep that account connected; a different account cannot
replace it silently. Google reconnect/disconnect does not delete Drive files.

Only finished `exports/*.pdf` files move. Building blocks, source PDFs, saved
book definitions, export snapshots and notes remain on the private volume.
Fresh exports are registered before a Drive transfer. A failed transfer returns
a usable local export with a visible retry warning, never an instruction to
generate the whole booklet again. Slow generations can finish locally and be
transferred separately. Transfers support PDFs up to 512 MB in bounded chunks.

The app reserves and commits the exact Drive file ID before uploading. Retrying
after a timeout checks that ID, avoiding duplicate uploads and overwrites.
Metadata, size and checksums are verified before the mapping is committed and
the local PDF is removed. No file is evicted on ambiguous or failed verification.
Use **Eerdere PDF’s naar Drive verplaatsen** for existing versions (including
soft-deleted versions). This moves one PDF per request and can stop/resume.
Cleanup and transfer remain available when the application quota is full.

Existing authenticated PDF and digital-preview URLs remain unchanged. A Drive
PDF is downloaded to a quota-checked private temporary file, SHA-256 verified,
served/rendered and removed when the stream closes. One Drive download is allowed
at a time. Interrupted temporary downloads are cleaned on service startup.
Preview PNGs remain disposable local caches. No OAuth token, upload session URI
or direct bearer download URL is returned to the browser or logged.

Soft deletion only hides the export in Boekjesmaker. Restoring it works without
moving its Drive file. Explicit permanent removal of an older, already-deleted
export sends its exact verified app-created PDF to the **Drive trash**, confirms
that operation, then removes its local history. It never empties Drive trash.
If Drive is unavailable, the history is retained for retry. The newest export
remains protected by the existing rule.

Back up the private volume database and keep the Drive folder: after migration
the volume alone no longer contains finished PDF bytes. The initial local-only
`prepare_import.py` tool is not a backup/export mechanism for a Drive-backed
library; it requires every PDF locally and fails rather than silently omitting
remote exports. Restoring such a service requires its database, encrypted Google
connection and the original Google OAuth application/account. Turning Drive
storage off affects new exports only; previously moved PDFs stay in Drive.

Protocol references: [Drive resumable uploads and pre-generated IDs](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[Drive file metadata/checksums](https://developers.google.com/workspace/drive/api/reference/rest/v3/files),
[per-file OAuth scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

PDF downloads stream in chunks. Upload limit is 50 MB. One mutation or preview
render runs at a time; further requests get 429 and a retry message. One Gunicorn
worker is required because the semaphore/OAuth preparation cache is process-local.
Generation timeout is 180 seconds; oversized work may need further optimisation.
The service should fail independently from the train board. Never increase limits
silently. Disable access by clearing BOOKLETS_INTERNAL_URL without deleting data.
Restore the dedicated volume backup for recovery; never restore Postgres for a
booklet issue. Published PDFs are immutable and stored alongside their snapshots.

## Tests

### Ticketbronnen en vulpagina’s in de reis

Een ticketophaler kan `ticketSources` bevatten (ns, mav, db, obb, cd).
`ticketSourceMode=all` combineert beschikbare bronnen; `fallback` stopt bij de
eerste bron die een complete set oplevert. Minstens één bron is nodig, aanvullende
bronnen zonder ToDo-referentie mogen leeg blijven. Mislukte aanvullende imports
geven een waarschuwing; een mislukte herimport vervangt geen bestaande selectie.
Elke bron blijft afzonderlijk herleidbaar in `ticketImport.providers` en de
oorspronkelijke pagina’s blijven beschikbaar. MAV gebruikt één pagina per PDF.
Expliciete vertrekdatums/tijden en documentkoppen sturen de sortering; onbekende
volgorde geeft een korte waarschuwing en behoudt de volgorde van de bronnen.

`tripFiller` is een instelling op een hoofdstukplek in een sjabloon of boekje,
voor één vaste PDF-pagina. Bij de export is aanpassen naar een veelvoud van vier
optioneel. De pagina wordt op zijn eigen plek behouden of weggelaten, inclusief
de gevolgen voor inhoudsopgave en rechterpagina’s. `fillerRequiredDays` telt
vertrek- en einddatum inclusief; onbekende reisduur behoudt de pagina met melding.
`fillerPriority` 1 betekent liefst behouden, 99 betekent eerder weglaten.
Een begrensde zoekactie kiest zo weinig mogelijk weglatingen; als geen passende
combinatie gevonden wordt, blijven de bestaande algemene vulpagina’s beschikbaar.
De opgeslagen samenstelling en eerdere PDF’s worden niet aangepast.

## Testcommando’s

From repository root: npm run check:syntax, npm test, npm run test:browser.
From booklets: python test_cloud.py and python test_migration.py.
Validate private access, owner vs KM member, cross-origin rejection, upload,
generation, previews and PDF downloads online after deployment. Do not claim live
verification based only on local tests.


### Niet-beschikbare ticketlinks

Een ticketknop die HTML in plaats van een PDF levert, krijgt de expliciete foutcode
`TICKET_NOT_PDF`. De automatische en handmatige import slaan alleen die knop over;
andere actuele ticket-PDF's blijven beschikbaar. De melding noemt de referentie en
PDF-knop. Een overgeslagen niet-PDF-link is een rustige importnotitie; een ontbrekende actuele referentie of datumconflict blijft een controlepunt.
Een expliciet geannuleerde referentie gebruikt nooit een oudere bevestigingsmail
of een Drive-terugval. Andere referenties kunnen wel worden opgehaald. Netwerk-,
rechten-, inspectie- en opslagfouten worden niet als annulering behandeld.

Bij een actuele ÖBB-mail met alleen een ticketportallink verschijnt direct een
knop naar de ticketpagina, met uitleg dat de PDF eerst moet worden gedownload en
geüpload. Alleen de gecontroleerde HTTPS-host en het bekende postcheckout-pad
worden toegelaten. Er wordt geen ticket uitgegeven of automatisch gedownload bij
ÖBB. Ticketportaal- en downloadlinks blijven uitsluitend tijdelijk in het browsergeheugen en worden
niet in het boekje opgeslagen. Na herladen zoekt de knop de actuele mail opnieuw.


### Ticketoverzicht en navigatie

Ticketpagina's krijgen conservatieve weergavegegevens uit expliciete PDF-labels:
route, reizigersaantal en eventueel ticketnummer. Het overzicht groepeert route,
datum, documenttype en aantal personen. Vervolgpagina's van dezelfde ticketbron
worden niet opnieuw geteld. Onbekende aantallen blijven onbekend; aantallen per
richting of reservering zijn geen totaal aantal unieke reisdeelnemers. Bestaande
boekjes kunnen de details opnieuw lezen zonder hun handmatig gekozen pagina's
of bevestigde datums te vervangen. Het boekje blijft onopgeslagen tot opslaan.

Alfabetische NS-referenties gelden niet impliciet als ÖBB-referentie. Korte
ÖBB-codes vereisen een expliciete ÖBB-aanduiding; zestiencijferige boekingscodes
blijven direct herkenbaar. Bestaande onterechte ÖBB-meldingen worden alleen
opgeruimd als dezelfde code aantoonbaar in de opgeslagen NS-import zit; concrete
ontbrekende andere referenties en datumproblemen blijven controlepunten.

Uitgegeven ÖBB-ticketlinks onder het bekende `/en|de/ticket/voucher/`-pad mogen
als PDF worden opgehaald. Ticketuitgifte- en bestelacties worden niet aangeroepen.
Bij HTTP 403 meldt de app de weigering met een rechtstreekse downloadknop; de
gebruiker kan de PDF zelf ophalen en uploaden. Beveiliging wordt niet omzeild.

Browsergeschiedenis gebruikt uitsluitend schermsoort en object-/groeps-ID in
de URL en history state, geen klantinhoud. Terug/vooruit en opnieuw laden openen
het betreffende opgeslagen scherm. Onopgeslagen wijzigingen vragen de bestaande
bevestiging en een lopende groep blokkeert verlaten. De vaste knop voor terug
naar de groep en de actie bij pagina's kiezen bewaren de correctie, controleren
dat ene boekje opnieuw en behouden de andere groepsregels.


Dialogen hebben ook een eigen tijdelijke stap met een zichtbare terugknop en
kruimelpad. Terug/vooruit herstelt de oorspronkelijke DOM en formulierinvoer
zonder opnieuw ophalen of opslaan. Maximaal 24 stappen blijven uitsluitend in
het werkgeheugen, gebonden aan hetzelfde boekje en dezelfde boeking. Sluiten
verwijdert die stappen; verlopen en afgeronde voortgangsschermen worden overgeslagen.
Herladen opent het opgeslagen hoofdscherm. Late ticketresultaten mogen een
verlaten stap niet heropenen of alsnog pagina's aan het boekje toevoegen.
