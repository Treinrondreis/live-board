# Print&Bind magazine ordering

The latest immutable export has a **Prijs & bestellen** button. Defaults: A4
portrait magazine (`tijdschrift`), folding/stapling on the long side, duplex,
full colour, 100 g interior, 250 g cover, no rounded corners or extra cover
finishing, two copies, post and standard one-day production. Production is not
the postal delivery time. Copies, paper, cover, colour and standard/fast/budget
production are editable. The PDF must contain at least eight A4 portrait pages
and a multiple of four; downloadable-only exports are rejected.

The exact export snapshot identifies the Sanity booking. Its latest address is
read with a minimal GROQ projection; no Sanity mutations are implemented.
Street/house-number suggestions remain editable. Missing/unknown countries are
never defaulted to NL. The country picker uses the documented ISO list; foreign
destinations use `international` instead of domestic `post`. Corrections apply
only to the order and do not update Sanity.

## Credentials and test boundary

The main Node service uses `PRINTENBIND_API_TOKEN`. Optional sandbox operation uses
`PRINTENBIND_ENVIRONMENT=sandbox` and a separate `PRINTENBIND_SANDBOX_API_TOKEN`.
Sandbox never falls back to a live token. Tokens stay server-side and are sent
only to the fixed official HTTPS API origin without redirects. They are not
returned in browser responses, sent to the PDF service, or written in order data.

API contract: <https://www.printenbind.nl/api/docs#/>. The current order schema
requires `articles` as JSON strings, despite object examples in the documentation.
`number` comes from the verified PDF, never the browser. Prices add the documented
reduced/standard tax to `amount`; shipping is already included in `amount` and
must not be added a second time. Incomplete prices cannot be confirmed.

## Data flow and duplicate protection

Prepare reads the exact current export from private booklet storage, including
verified Drive-backed PDFs, and checks its A4 geometry, page count and SHA-256.
Price calculation sends address/configuration, not the PDF. The quote stores
the exact settings, PDF checksum, price, token fingerprint and 15-minute expiry
in the private booklet database. Changing any field clears the browser quote.
Before ordering, the server checks expiry, credentials, exact PDF and fresh price.

A durable SQLite claim permits one order per export, across double clicks and
process restarts. Only explicit final confirmation starts a private streamed
PDF upload; the Drive file never becomes public. An immutable generated filename
and unique order reference bind the uploaded PDF and receipt to that export.
Known upload/validation failures can be corrected. Once an order POST may have
been sent, retries only look up its unique reference and never submit another
order. An unresolved upload/process interruption remains blocked for manual
review; it is never automatically treated as a safe re-order.

Receipts show printer status; creating an order is not proof of payment or
production. Completed quotes with delivery data expire from local storage after
seven days on subsequent quote writes; unresolved operations retain their quote
for recovery. Minimal receipt/reference state is retained for duplicate protection.

## Validation limits

Automated tests and browser QA use fictional data and a local printer simulator;
no customer PDFs, addresses, orders or credentials enter Git or CI. A real
read-only price calculation was attempted with the documented article format
and public documentation example address. The price service returned HTTP 500;
the authentication check succeeded. Do not report live pricing or real order
production as verified until Print&Bind resolves or explains that response.
No live document upload or order was performed during development.
