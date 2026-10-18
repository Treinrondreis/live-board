# Reisschema controls and reviewed Gmail drafts

## Data flow and defaults

The owner-only Reisschema section reads active legs from the private central register.
Planning observations, controls, drafts, communication and receipt evidence are append-only
events in that register. Original itinerary fields and documents are never rewritten.
The existing app database stores an optimistic-lock checkpoint, expiring worker lease,
resumable result queue, hashed receipt-token records and separately encrypted draft credentials.
No extra database/service/subscription is introduced. Nothing writes to Sanity.

Daily checks are initially OFF. Enable explicitly in the owner-only section after deployment.
A timer wakes on each minute. One scheduled round starts at 00:30 Europe/Amsterdam
(including summer/winter time), within D-15 through D0. When enabled after 00:30,
the first scheduled round is the next night; manual checks remain available immediately.
A service restart after a missed scheduled run catches up, and unfinished rounds retry.
Newly active versions wait for the next daily round or an explicit manual start. Manual start also works while the daily setting is off. A completed daily
round is not repeated; manually verified observations can be entered independently.

Where no usable full endpoint match exists, create one persistent manual DB task at D-8.
Late registration creates an overdue task. Previously covered legs that lose coverage
also become manual. The DB task opens https://int.bahn.de/nl; there is no browser scraper
and no automatic declaration that a missing train is cancelled.

Every result records time of checking separately from source observation/publication time.
The register exposes the latest control and last control without a detected change separately.
Repeated remote writes use deterministic request IDs. Persisted queue evidence is replayed
after restart, rather than recomputing timestamps with the same idempotency key.

## Source inventory and actual coverage

| Source | Existing application | New date-specific control |
| --- | --- | --- |
| NDOV IFF | `nl-planning.mjs`, board horizon yesterday to D+2 | Separate bounded worker, requested travel dates within the actual delivery period; number/category, service calendar, endpoint order, boarding restrictions and overnight clocks checked |
| NDOV RIT/DVS | Existing real-time/near-term collectors | Not used as proof of a 15-day planning horizon; planning and live delays remain separate |
| Patrick GTFS | Private trial ZIP, weekly source deliveries | Optional authenticated bounded worker; calendar exceptions, >24h clocks, feed version, origin service day and all matched trip IDs retained |
| SNCF | `france.mjs`, static GTFS, GTFS-RT and SIRI | Optional static-feed worker using the existing official URL; no real-time prediction is used as a planned time |
| NMBS | `belgium.mjs`, authenticated GTFS and updates | Optional static-feed worker using the existing BMC partner key and official endpoint |
| Entur | `entur.mjs`, next-day station calls | Inventoried; existing board data does not establish full future itinerary coverage. Manual DB fallback |
| Sweden | `sweden.mjs`, Trafikverket announcements | Inventoried; no unverified future-data coverage assertion. Manual DB fallback |
| OeBB | `oebb.mjs`, HAFAS/Scotty board calls | Inventoried; existing departures are not a verified 15-day full-route plan. Manual DB fallback |

ICE/Nightjet through NDOV requires both checked endpoints to be in the Netherlands.
An international leg with only one Dutch endpoint is NOT marked fully checked by NDOV.
EuroCity/EuroCity Direct can match an international IFF leg only when both registered
endpoints, number/category, calendar and times really occur in the same supported segment.

GTFS splits with the same explicit train number may join only at a shared boundary station,
on the same service day, in chronological order; all source IDs are retained. Missing middle
sections are not invented. Unnumbered RJ matches require a unique full endpoint pair and
matching destination. Source differences of three or more minutes and ambiguous candidates are manual.
Name matching strips accents/case/punctuation only; it does not collapse distinct stations
such as Montpellier Saint-Roch and Montpellier Sud de France.

Downloads are bounded to 30 MiB compressed, individual selected files to 100 MiB,
worker heap to 256 MiB, with timeouts. Freshness requires a Last-Modified no older than
8 days. Missing freshness evidence, oversized feeds or unverified service/category names
fall back to manual. The SNCF public ZIP and its Last-Modified metadata were smoke-tested in the bounded
worker against a public rail service; this confirms the source format, not full coverage.
NMBS endpoint and freshness compatibility still require a real source smoke test before
enabling. Fixture tests do not prove provider coverage.

Configuration, supplied through secret environment settings (never Git):

- `REISSCHEMA_PATRICK_ENABLED=1`, `REISSCHEMA_PATRICK_USER`, `REISSCHEMA_PATRICK_PASSWORD`.
- `REISSCHEMA_SNCF_ENABLED=1` enables the existing SNCF static URL.
- `REISSCHEMA_NMBS_ENABLED=1` reuses `BMC_PARTNER_KEY`.

## Human review and communication

Departure >=4 minutes earlier is urgent. Departure >=4 minutes later requests a draft,
without the earlier-departure urgency. Arrival differences are shown without inventing a
notification threshold. Missed connections require observed times at both endpoints;
reduced or unchecked connection margins request review without inventing a minimum.
Backups always need reassessment. Cancellation, station changes and missed connections
request reservation review. Manual station changes are part of the change fingerprint.
A changed Nightjet boarding station displays the internal Newrest/no-show warning; no
message to Newrest is sent. Existing Wien Hbf/Meidling document rules remain a human check.

Draft creation requires a recent, persisted verified observation for the exact active
change episode, a reviewed recipient address, destination of that travel day and concrete
advice. It does not attach documents or claim an attachment. Gmail alias verification and
the alias's existing nonempty signature are required. Uncertain Gmail POST outcomes are
not automatically retried; check Gmail manually before attempting recovery.

Gmail drafts are made in reservations@treinrondreis.nl with contact@treinrondreis.nl as
From. There is no send endpoint or background send operation. A human edits and sends in
Gmail, then explicitly records communication for the current change. Receipt is separate.

The old read-only OAuth client/credentials are unchanged. Configure a SEPARATE Google
OAuth client using `REISSCHEMA_DRAFT_GOOGLE_CLIENT_ID` and
`REISSCHEMA_DRAFT_GOOGLE_CLIENT_SECRET`, with this authorized redirect under the configured
`FLORA_PUBLIC_ORIGIN`: `/seinhuis/reisschemas/google/callback`.
Connect via the owner-only button. Consent requests gmail.compose and gmail.settings.basic
to create drafts and read the verified alias/signature. Google compose scope technically
allows more operations, including sending; this server wrapper exposes ONLY profile,
alias read and drafts.create. Credential isolation and endpoint restriction are active
code controls; they do not narrow Google's underlying OAuth scope.

Receipt links contain 256 random bits and no dossier/email. Store only token hashes.
GET does not confirm anything: a same-origin form POST requires a deliberate button click.
An old link cannot confirm a later/reverted change episode, expired token or unregistered
communication. When a corrected version directly replaces the original and exactly applies
the observed times/stations, the original notification remains separately available. The
register verifies the active replacement under the booking lock before accepting draft,
communication or receipt evidence on that original issue. Any subsequent changed observation
on the replacement retires the old link permanently, even if its times later revert. A
second replacement or a nonmatching/cancelled replacement is not implicitly treated as the
same issue; those cases require explicit manual follow-up. Original inactive observations
cannot be rewritten through this exception.

## Manual release sequence

1. Review/test the register PR against its existing production source branch separately
   from unrelated register PRs. No schema migration is needed: new data uses events.
2. Manually deploy the reviewed register revision first. Verify its private health endpoint.
3. Review/test and manually deploy live-board. Keep daily checks disabled initially.
4. Configure source secrets outside Git, smoke-test real coverage, then enable controls.
5. Configure/consent to the separate Gmail client. No Gmail credential grant is implied
   by code deployment. Test with a fictitious internal address before customer use.
6. Verify both notification lifecycles with fictional data: still-active original, and an
   exactly applied direct correction. More complex cancellations/rebookings stay manual.

Code and fixture checks do not establish live provider availability, Google consent,
successful production deployment or complete privacy coverage.

## Manual reruns and source activation

An explicit manual start creates a new durable round, including when a round already
completed today. A retry of an unfinished round resumes its saved evidence and IDs.
Scheduled ticks still deduplicate the completed daily selection. Source availability,
source modification times, full matching counts and pending writes are stored in the
checkpoint and shown to the owner. Availability is not a claim of full route coverage.

The initial production round on 18 October checked six leg rows through IFF and created
two manual tasks. It did not check all registered future journeys.

Entur investigation (18 October): the official per-operator GTFS exports for SJ Nord,
Go-Ahead and Flytoget were downloaded outside Git. Their trips header does not contain
trip_short_name; internal ServiceJourney IDs must not be guessed as public train numbers.
The Vy export exceeds the current 30 MiB compressed bound. The official Journey Planner
supports date/privateCode filters and is a possible separate adapter, but complete
number/date/endpoint matching has not been verified. Entur remains a manual fallback;
its existing near-term departure boards are not used as proof of a full future journey.
Official references: https://developer.entur.no/open-data/timetable and
https://developer.entur.no/docs/open-services/journey-planner.


## Source agreement policy

Every configured feed is fetched and parsed before comparing full matches of the same
registered leg/date. The fixed source order is NDOV IFF, GTFS.de, SNCF GTFS, iRail, NMBS GTFS.
Differences of at most two minutes at BOTH endpoints are accepted; the first matching
source remains the displayed time, never an average. Evidence from all matches includes
their actual compared dates/times and fetch timestamps. A spread of three or more minutes
at either endpoint, or conflicting cancellation status, requires manual review immediately,
also earlier than D-8. The maximum spread across all matching sources is used.

All participating evidence must have been fetched/checked within four hours. The feed's
publication date remains separately recorded and may be older for weekly sources. A stale
participating feed is fetched again once per prepared round; if this fails or the match
vanishes the contradiction is NOT silently resolved using the remaining source. Fresh
participating feeds already meet the recheck requirement; do not download them repeatedly.
An interrupted queue older than four hours is recomputed instead of publishing stale
comparison evidence. No automatic customer communication is triggered.

## Belgian train queries and bounded fallback

With REISSCHEMA_IRAIL_ENABLED=1, try iRail for each selected leg. Resolve station and
vehicle identifiers from provider responses, then validate the explicit train number,
ordered unique endpoints, local departure date and scheduled endpoint timestamps.
Never add live delay to planned times. A missing/ambiguous/error response cannot prove
cancellation. The NMBS feed is downloaded once for the remaining unmatched legs only;
when all legs have an iRail match, the ZIP is not downloaded. Existing other-source
agreement checks remain active; iRail and NMBS are not treated as independent evidence.

Only public station identifiers, train identifiers, dates and times leave the server.
No dossier or customer identifiers are sent. At most 250 HTTP requests per prepared
round, sequentially spaced by at least 1.1 seconds; 429 stops further requests for that
round. Responses are bounded to 2 MiB, timeouts to 20 seconds. Duplicate queries share
the round cache and its original fetch timestamp, honoring Cache-Control up to four hours.
The NMBS fallback streams calendars and stop times (512 MiB unpacked limit per streamed
file, 64 KiB CSV record bound) inside the existing 256 MiB-heap / 120-second worker.
Other files retain the 100 MiB bound. Official NMBS stop-name translations are supported.

One-off local quality check on 18 October 2026: six stations, 72 unique vehicle/date
requests for 19 and 25 October; 68 usable responses had identical passenger stop order
and scheduled times compared to the same-day NMBS static delivery. Four requests failed
(three replacement buses and one Eurostar). All six station boards for 1 November were
empty: this is missing coverage, not proof of cancellation. This sample does not establish
complete coverage or independent correctness; both products may use underlying NMBS data.
Raw public responses and the authenticated ZIP stay outside Git. No customer dataset
was used in the quality sample. See https://docs.irail.be/ for limits and semantics.
