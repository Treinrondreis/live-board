# Private KM 2026 photo archive

The KM-trein **Fotoarchief** page archives registered original images from the
live 2026 competition to the separate private Google Drive folder **KMtein26**.
Videos, claim documents, test-edition objects and unregistered bucket objects are
excluded. Existing reduced previews stay in S3, preserving fast rendering in the
app and public liveblog. Uploading new photos continues using the existing S3
flow; run the archive again to include later uploads. Nothing writes to Sanity.

## Access and storage

KM uses the existing private Boekjesmaker service solely for its Google Drive
connection. OAuth tokens remain encrypted in that service; the main Node service
does not receive them. `drive.file` is sufficient. The original account remains
required. No sharing permissions or public Google links are created. The archive
folder is created by the same Google application, not by a separate connector.

Internal `/internal/km-archive/*` calls require the private gateway secret and
are blocked by the public Boekjesmaker proxy, including encoded path aliases.
The storage service validates owner, original photo UUID, live-2026 identity,
image MIME allowlist, 15 MB limit, transmitted size, MD5 and SHA-256. It reserves
the Drive ID before upload and verifies Drive metadata/checksums before committing
the mapping. Temporary uploads are quota checked and removed on completion or
service startup. At most two internal photo operations run concurrently; they do
not take the PDF generation semaphore. Credentials, photos and provider responses
are never printed or included in Git/CI.

The Node side confirms the response against the original bytes, commits the
`media-drive` record, rechecks the S3 object and only then removes the original
from S3. The existing object key is immutable through the app. A shared per-photo
lease prevents concurrent participant deletion and archiving. Deleted/deleting
owners cannot be reattached by a stale archive operation. Existing previews and
source metadata are retained. A failure leaves a source copy or the already
verified Drive copy reachable; a retry reconciles the same ID. Failure to commit
the final status after S3 deletion can resume without reuploading.

Original-photo requests retain existing application authorization. The resulting
app URL is signed, bound to owner/photo, expires after two minutes and is checked
again against the current media record. Tampering, expired links, removed photos
and the test edition are rejected. The private service verifies downloaded bytes
before the Node service sends them to the viewer. Previews continue through the
existing S3 URLs. Deleting an update/participant also trashes its exact verified
Drive original before removing the application's mapping. Drive outages stop
deletion so it can be retried; Drive trash is never emptied automatically.

## Operating and recovering

Open `/treinhuis/#photo-archive` with an authorized KM administrator account. Start
with **Eén foto overzetten en controleren**, use the original-photo check and
verify its Drive entry before starting the rest. The setup checks available
Drive quota for the remaining originals. A job uses two transfers at a time and
continues when the screen closes. Pause stops after current transfers. Completed
photos are committed individually; a process restart requires explicitly starting
the remaining photos again. Errors are skipped for that run, preserve available
copies and can be retried on the next start. The status shows actual archived
photo count and reclaimed original bytes, not the whole bucket size.

Back up both application databases and retain the private Google connection and
Drive folder. Once S3 originals are removed, an S3 backup alone does not contain
all original photos. Keep the original Google OAuth application/account when
restoring. Do not remove the private storage service while KM originals depend
on it. The `media-drive` records and the private SQLite photo registry must be
restored together. No source copies are deleted during tests.

Tests use synthetic bytes, mocked Drive/S3 and temporary databases only. Live
verification must separately cover a trial transfer, original download through
the protected app route, preserved preview, source removal and final counts.
