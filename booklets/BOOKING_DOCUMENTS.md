# Personal books from Sanity bookings

Templates support `choice: "document"` slots with `documentKind` `schedule`,
`nsTickets`, `voucher` or `letter`. Templates never contain selected customer
documents or a booking binding. Personal books bind to a stable exact Sanity
document ID; duplicate booking numbers require explicit selection. Draft and
published counterparts count as one booking. The latest draft is the current
staff working version.

The chapters are shown as "Brief ophalen", "Reisschema ophalen", "NS-tickets
ophalen" and "Vouchers ophalen". Choosing the exact customer booking starts a
sequential import into all empty, non-omitted slots. Existing slots in templates
work without migration. Already selected documents and edited page order are
preserved on retry and on refreshing the same booking. Stopping or changing the
booking invalidates all pending results. Each failure is reported on its own
chapter and does not stop the remaining chapters.

One linked letter is used automatically; several letters require selection.
All linked vouchers must be approved before the complete set is imported in
Sanity link order. Multiple vouchers retain every source digest through page
editing. A missing linked voucher falls back to a unique recommended Drive
voucher, which is loaded with `reviewRequired` and blocks PDF export until the
user reviews its pages and confirms the details. A unique recommended schedule
is imported from Drive. Duplicate booking numbers and multiple recommended
Drive files always require a user choice; modification date alone is not enough
to choose among different documents.

Customer values are `klantvoornaam`, `klantachternaam`, `vertrekdatum`,
`terugkomstdatum`, `reisnaam` and `boekingsnummer`. Existing text placeholders
use these values. Changing the binding clears all document slots. Imports guard
against switching books or bindings while a request is in flight.

The main Seinhuis service reads private Sanity bookings with the existing
`FLORA_SANITY_READ_TOKEN` Viewer token. It exposes only authenticated, CSRF
protected POST queries under `/api/booking-data/`. Tokens never reach the
browser or the Python service. Customer letters are `doc` documents linked
through the booking's `docs`, with a title starting with `Briefing:` or `Brief:`.
Referenced reusable texts are read from the published perspective, preserving
their order. Variable marks use the selected tourBooking context; missing
required variables, circular references and unsupported content stop the
import rather than silently dropping text.

The actual green voucher tick is `approved: true` on the voucher document,
often in `drafts.private.*`. Always read the latest counterpart; never infer
approval from the booking status, `_status: unsaved`, its filename or a completed
hotel todo. Only approved linked vouchers can be loaded from Sanity. Drive and
manual uploads require the user to check customer, hotel, dates and reference.

Drive lookup requires explicit OAuth `drive.readonly` consent on the existing
Google connection and the Drive API enabled. Existing Docs and PDF files are
searched by booking number, with filename boundary checks. Schedule keywords
include `reisschema` and `tijdlijn`, found in the
existing Drive naming. No file is moved, edited or deleted. Existing Docs are
exported to PDF, then selected pages are fitted to the book format. Native PDF
text and barcodes remain vectors; source PDFs remain untouched.

NS slots reuse email import, newest email per DNR, all ticket buttons and page
selection. Automatic imports use only the exact booking's stored references.
Every reference needs a latest, non-cancelled email with ticket buttons. Unknown
references, cancelled latest messages and partial download failures require
manual resolution and never insert incomplete ticket sets. A duplicated numeric
booking lookup without an exact document ID is
rejected. Missing document slots block PDF generation even if ordinary library
choices are skipped. Users may explicitly omit individual documents.

Imported customer documents are snapshots with source metadata. Before normal
UI export, Sanity documents and published references are reread and their
content digest checked. Changes require a new import and page review, preserving
the saved selection. Existing printed PDFs remain immutable. Drive and ticket
snapshots are refreshed explicitly through "Opnieuw ophalen".

Tests: `node --test booklets-bookings.test.mjs booklets-mail.test.mjs`,
`node booklets/test-booking-ui.cjs`, `node booklets/test-auto-booking-ui.cjs`,
gateway tests and Python document tests.
