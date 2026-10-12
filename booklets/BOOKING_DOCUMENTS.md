# Personal books from Sanity bookings

Templates support `choice: "document"` slots with `documentKind` `schedule`,
`nsTickets`, `mavTickets`, `dbTickets`, `obbTickets`, `cdTickets`, `voucher` or `letter`. Templates never contain selected customer
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

Document slots can set `todoCondition`, e.g. `CORA2`, to require the complete
phrase in a single booking ToDo's title/description (case and whitespace are
normalized). No match clears the selected document and skips the chapter,
including its contents entry and page count. The result is bound to the exact
booking ID and condition text in `todoConditionState`; it is cleared when
copying to a template or changing bookings. The UI rechecks the current ToDos
before exporting. Unchecked, stale or failed conditions must not silently skip
a chapter. A matched condition with missing tickets still requires attention.

One linked letter is used automatically; several letters require selection.
Only approved linked vouchers are imported, sorted by check-in date by default; unapproved
vouchers are skipped and reported. Multiple vouchers retain every source digest through page
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


## Chapter settings and ToDo matching

Every document slot has its own chapter name, TOC title/visibility and numbering
settings. New letter, schedule and voucher slots default to numbered; NS slots
are unnumbered. Existing slots keep their prior behavior until configured.
Position percentages are editable with a first-page preview; there is no claim
that an arbitrary ticket footer is empty. New TOC fields use Open Sans 10.5 pt,
#1A1A1A; existing fields have an explicit recommended-style action. Legacy generated
TOCs use Montserrat headings and the same Open Sans body color.

Choice options can override a block's ToDo match text. Route blocks store a
match phrase in their own metadata. The entire phrase must occur inside one
ToDo, ignoring case and repeated whitespace. No fuzzy word matching. Exact
booking selection supplies title/description only; ambiguous matches require a
user choice. Manual overrides persist on retry. Refreshing a block preserves
choice-local phrases while route phrases follow current library metadata.

Separate NS slots can be marked outbound/return. They reuse the same downloaded
source within one import, but require independent explicit page selections.
An unchecked direction slot blocks export. Removed pages can be restored from
original immutable assets, without erasing selections in another slot.

The standard Sanity import requests the original document from the official
fixed www.treinrondreis.nl/api/v2/doc/<verified-linked-id>.pdf renderer using
background=true. The existing Sanity Viewer credential is sent only to that
fixed first-party export endpoint, never redirects. Ownership and voucher
approval are verified before requesting PDF bytes. Responses are bounded at
30 MB and PDF signatures checked. If the renderer refuses access the import
reports it and offers a manual original PDF upload; it does not silently rebuild
the page. The Python import stores native PDF bytes unchanged. The legacy text
renderer remains available for existing integrations and identifies its output
as recreated text, rather than an original PDF.

## Booking letter house style

New letter retrievers use the Sanity text renderer by default, with an embedded
Treinrondreis logo, contact header, company footer, Open Sans 10 pt and 11 pt
subheadings. A4 uses 27 mm side margins and reserves header/footer space; A5
landscape uses narrower margins. The document title remains metadata, rather
than a large printed "Briefing" heading. Address and greeting come from Sanity;
images, bullet lists and explicit page breaks retain their original order.
This is a house-style recreation, not an identical original Sanity PDF.
Existing explicit original-PDF settings stay selectable; choose "Brief in
Treinrondreis-huisstijl" and retrieve the letter again to switch an existing
chapter. Source content, approval checks, immutable prior PDFs, and Sanity itself
are unchanged.

## Voucher house style and ticket page inspection

New voucher retrievers also default to the recreated house style. The gateway
retains voucher tables as structured rows after read-only variable expansion;
the PDF displays bold labels beside their original values, without table borders.
The letterhead, hotel headings, address and contact footer follow the letter
style. Approval, missing-field warnings and booking ownership remain enforced.
Existing explicit original-PDF settings can be switched via the retriever settings
and reimporting; original uploads continue to retain their native PDF bytes.

Both NS ticket page pickers display a larger top-half thumbnail. The separate
full-page inspection dialog supports 50–300% zoom, using a cached 2200-pixel
preview behind the existing authentication and asset/page validation. Opening,
zooming and closing it do not modify the selection. Ordering/removal and PDF
composition always operate on whole source pages; the thumbnail crop is visual
only. Other document page pickers retain whole-page thumbnails and can zoom too.

## Carrier ticket imports and dated selections

All ticket retrievers share the large top-half thumbnails, full-page zoom and
individual page controls. They read the selected booking's rail ToDo supplier
references. Hotel references are excluded. MAV/DB/ÖBB/ČD validate carrier senders
and exact labelled reference numbers, support PDF attachments and bounded direct
PDF links to fixed carrier hosts. Invoice, refund and tax-receipt attachments are
excluded. The latest cancellation blocks reuse of old tickets. Duplicate booking
numbers require the exact Sanity booking ID. No Sanity documents are modified.
Gmail queries search both compact Sanity numbers and ÖBB/ČD's grouped spelling;
mail bodies containing spaced digits do not match a compact quoted phrase alone.

MAV defaults to page 1 of each ticket PDF. The original PDF remains unchanged.
ÖBB post-checkout links can be shown for manual use, but are never followed to
issue/redeem tickets; an invoice or VAT certificate cannot substitute for a ticket.
Other carriers need an existing PDF attachment or supported direct PDF link;
unsupported mail/portal variants use manual upload.

Ticket PDFs staged by a ChatGPT task in Google Drive are another supported
source. Name them `Tickets OBB 0726369981792179 2026-10-09.pdf` (substitute
NS, MAV, DB or CD and the actual reference). Drive read access is required.
The mail picker and automatic fixed chapters check Drive for missing PDF sources
by the exact carrier reference; cancellation mails block this fallback.
The separate "Tickets uit Google Drive zoeken" button also permits a manual
booking-number search. Manual results must be inspected before adding them.
Original PDF bytes are imported without re-rendering the tickets. Page selection,
date review, MAV's first-page rule and zoom work as with email tickets. Exact
duplicate filenames use the newest Drive version. Invoice/refund/tax files and
other carriers or references are excluded, and download revalidates metadata.
ÖBB portal fetching remains unsupported because server access was denied;
the staged PDF route does not require server access to the ÖBB ticket portal.

`ticketMoment` and `voucherMoment` are integers 0–99 (0 means all dates).
1 is the earliest distinct departure/check-in date, 2 the next distinct date,
and so on. Same-day tickets stay together even if they cover different trains.
`sortByDate` defaults to true for ticket/voucher slots. Sorting happens within a
chapter; template chapter order never changes. Different carrier imports have
separate per-run caches; two slots for the same carrier share native source PDFs
but retain independent page selections.

Authenticated `/api/tickets/inspect` inspects labelled departure/validity dates
in PDF text. Issue dates, birthdays and mail receipt dates are not travel dates.
An exact reference's single ToDo startDate can fill a missing printed date.
Conflicting dates, multiple departure dates on one page and undated continuation
pages require confirmation. Check-in dates are read after Sanity variable expansion.
Unrecognised/scanned dates remain editable. An explicitly accepted unknown date
can be placed manually, but cannot identify a numbered moment.

Snapshots retain `pageSources` and `originalPages` with native asset/page IDs,
travelDate, dateSource and review flags. Manual date edits update both selected and
original records, so restoring/filtering preserves the corrections. Changing a
slot's moment requires a fresh page confirmation. Dates and original page bounds
are validated on save; unresolved dates block export through reviewRequired.
Missing moments do not silently use another date. Old snapshots without date
metadata remain readable and acquire inspection metadata when their picker opens.
