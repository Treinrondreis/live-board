# Reishuis 0.3

URL: `/seinhuis/reishuis/`. Reuses the existing Seinhuis Google login, Railway
Postgres connection and `FLORA_SANITY_READ_TOKEN`. No new service or credentials.

Five configurable rows each show five booking photo cards, with independent paging
and shared search. The defaults are processing/newest created, processing/next
departure, Interrail delivery, waiting for customer and travelling now. Travelling
means status `afgehandeld` and departure <= today <= return in Europe/Amsterdam.
The server reads Sanity with GET and raw cursor pagination, preferring draft
records over their published counterpart. Projection contains booking identity,
name, status, dates, minimal payment amounts/statuses/deadlines and
`trip->imagesWithData[0]->image.asset->url` (with an embedded-image fallback).
Payment URLs are projected to a boolean; provider IDs, dashboard URLs, fulfillment
notes and other customer details are not fetched. The legacy status `wacht klant`
maps to the waiting row. There is no Sanity write path.

## Fast loading and status/payment filters

The last complete booking projection is stored in `reishuis_booking_snapshot` in
the existing Postgres database. Opening, F5, another approved browser and a server
restart reuse that central snapshot immediately. Only an empty initial snapshot
waits for the first Sanity import. A stale snapshot is returned while a single
background read refreshes it; failed or incomplete reads do not replace the last
successful snapshot. Errors use a 30-second retry delay. Refreshes are coalesced
per running server; the existing production service has one replica. This is not
a background automation: authorized requests trigger refreshes when needed.

Searching, filtering and paging run on the already-authorized in-memory browser
dataset, using the same presentation logic as the server. All current and future
source statuses can be selected or assigned to dashboard rows. Searching and
payment filtering switch to a unified result list across all statuses unless a
particular status is selected. No browser localStorage, IndexedDB or service
worker stores customer data. Each new page still authenticates and reads the
shared snapshot through the protected API.

Minute polls compare the booking version and edit revision; unchanged replies
contain only small metadata and preserve existing card/photo elements. During a
background update the UI polls every three seconds for completion. Open editors
and hidden pages only perform the lightweight role/session check every minute;
revoked/expired access clears already-rendered data without changing form revisions.
Photo downloads are coalesced and cached only behind authorization in bounded
server memory (64 images / 24 MB / one day). Responses remain private/no-store;
browser/public caching does not bypass role checks.

Payment lights summarize **registered payment requests**, not the invoice total
or proof of an email being delivered: grey = no active registered request, green
= all request amounts paid, yellow = some paid with amounts outstanding, red =
nothing paid. Fulfillment amounts take priority; a legacy `paid` status without
fulfillments settles that request. Refund amounts reduce paid amounts, and an
overpayment on one request does not silently settle another. Invalid amounts
produce a separate grey "Betaling controleren" state and filter.
Manual requests count even without a checkout link. "Zonder betaallink" includes
manual and absent requests. "Te laat" means an outstanding request whose valid
due calendar day in Europe/Amsterdam has passed, including partially paid requests.
Missing deadlines are reported and never invented. Cancelled/void requests are
excluded. Booking dates use `dateCreated`, falling back to `_createdAt`.

Cards have a 90px photo (74px on narrow screens), a prominent number without `#`,
name and departure in two lines to its right, a subtle booking date and a labelled
payment light. Color is accompanied by text; overdue gets a separate badge.

## Access and data boundaries

- Every page, script, stylesheet, image and API under the prefix requires the
  explicit `reishuis` app grant. Google admin does not bypass this grant. Legacy
  owner/member/recovery sessions do not grant Reishuis access. Existing country,
  approved-device, active-account and session expiry checks apply on each request.
- The existing Seinhuis access management page can grant/revoke Reishuis to users
  and admins. No migration automatically gives existing accounts access. An owner
  can use existing access management to assign it to their approved Google account.
- All responses are private/no-store, noindex, no-referrer, same-origin resource
  policy, nosniff and frame-denied. Strict CSP uses only same-origin assets.
- Writes require exact configured origin, JSON, a session-bound HMAC CSRF header,
  size/input validation and a compare-and-swap revision. No CORS allowance.
  `SEINHUIS_PUBLIC_ORIGIN` defaults to the existing production origin. CSRF HMAC
  uses the existing admin encryption key/password, or an ephemeral key in tests.
- Photos are fetched through the authenticated server, with exact Sanity project,
  dataset and image-path allowlisting, no redirects, no credential forwarding,
  MIME checks and a 5 MB bound. Raw CDN URLs are excluded from client responses.
- Errors use fixed messages and do not log customer data or credentials.

The `reishuis_state` table is created lazily on first authorized use, using the
existing storage adapter (Postgres in production, SQLite for tests). It stores
customers, booking-to-customer links, notes, personal row settings, a revision and
the last 500 edit actions. The separate booking snapshot stores only the narrow
read projection, including payment amounts/deadlines needed for the requested
filters, within the same protected database. This changes storage scope from
process memory to persistent central storage; it does not create public access.
The single-row CAS prevents lost updates across sessions and replicas. Initial
rollout is intended for the existing small internal dataset; this is not a bulk CRM.

Customers are explicitly created and bookings manually linked. Duplicate names
require a separate confirmation; a booking already linked to a different customer
is refused until explicitly unlinked. Merging requires both customer IDs, the exact
target name and confirmation, preserves notes and links and records the merge.
No automatic identity inference or Sanity identity change is performed. Customers
with the same name are distinguished by their local reference.

## Legacy Sanity assessment

An unauthenticated aggregate-only query on 2026-10-17 returned 532 `tourBooking`
documents, all outside `private.*`. This indicates an existing public legacy
exposure. No customer records were exported for this check. This change neither
changes Sanity permissions nor creates/publishes Sanity documents. Remediation of
the upstream public dataset requires separate, concrete user permission and an
impact assessment for existing consumers. Auth in Reishuis cannot fix that exposure.

## Validation and rollback

Use `npm run check:syntax`, `npm test`, `npm run test:browser`. Reishuis tests use
only explicitly fictional records. There is no separate application build script;
Railway installs the locked dependencies and starts the Node server.
The central guidelines' Python checks validate their own guidelines repository;
they are not a privacy certificate for this application. Review changed files
separately for credentials and PII before pushing.

Rollback via the preceding Railway deployment or a Git revert. The added table
can remain intact; rollback does not drop customer data or change Sanity. Do not
delete or migrate production data as part of a rollback test.
