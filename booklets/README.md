# Boekjesmaker in Seinhuis

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
and no public domain/TCP proxy. Limits: 2 GB RAM, 1 CPU, 5 GB application storage
quota. Railway provisioned a 50 GB volume and does not offer shrinking in this UI;
it bills used space. The app enforces the agreed 5 GB usage in upload/render/import
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
