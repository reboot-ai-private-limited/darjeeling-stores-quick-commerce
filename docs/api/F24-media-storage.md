# API · F24 Media Storage

Spec: [F24](../platform/24-media-storage.md) · Conventions: [00](00-conventions.md)

Files go **straight from the app to the storage provider** with a signed upload; the API only issues the permission and checks the result. Other endpoints store a `mediaId`, never a URL.

**Storage provider.** Today files live in **Cloudinary**. The API talks to storage through one internal interface, so moving to **S3 + CloudFront** later changes the provider and the shape of `upload` below, not the endpoints, the `mediaId`s or any other module. The examples show Cloudinary; where S3 differs it is noted. See [Implementation notes](#implementation-notes-backend-d2-3).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/media/upload-url` | Auth | Get a presigned upload for one file |
| `POST` | `/media/complete` | Auth | Tell the server the upload finished |
| `GET` | `/media/:id` | Auth | Status and URLs of a file |
| `GET` | `/media/:id/url` | Auth | Short-lived signed URL for a private file |
| `DELETE` | `/media/:id` | Auth | Delete my file |
| `GET` | `/admin/media/failed` | Admin `catalog:manage` | Files whose deletion failed |
| `POST` | `/admin/media/:id/retry-delete` | Admin `catalog:manage` | Retry a failed deletion |

## File kinds and limits

| `kind` | Who uploads | Limit | Result |
|---|---|---|---|
| `product_image`, `category_image`, `banner` | Admin (`catalog:manage` / `pricing:manage`) | Image ≤ 5 MB | Public WebP sizes 160 / 320 / 640 / 1080 |
| `rider_photo` | Rider, admin | Image ≤ 5 MB | Private |
| `address_voice` | Customer | ≤ 10 s, ≤ 500 KB (`m4a`/`aac`) | Private |
| `address_photo` | Customer | Image ≤ 5 MB | Private |
| `failed_delivery_photo` | Rider | Image ≤ 5 MB | Private |
| `refund_photo` | Customer | Image ≤ 5 MB | Private |

Order voice notes and house photos are not uploaded directly: the server **copies** the address files onto the order at placement.

## Upload flow
1. `POST /media/upload-url` → get the presigned POST.
2. Upload the file to S3 with that data (add a retry queue on weak networks).
3. `POST /media/complete`.
4. Use the returned `mediaId` in the address, product, refund or similar call.

## POST /media/upload-url
The caller must be allowed to upload that `kind` (table above) or the call answers `403 FORBIDDEN`. `order_voice` and `order_photo` can never be uploaded: the server makes them. Body:
```json
{ "kind": "address_voice", "contentType": "audio/mp4", "sizeBytes": 84210, "durationSec": 8, "ownerRef": { "type": "address", "id": "addr_1" } }
```
`ownerRef` is optional when the file is attached later (for example a new address); its `type` must fit the kind (`product`, `category`, `banner`, `rider`, `address` or `order`). `durationSec` is required for voice notes. 201 (Cloudinary):
```json
{
  "data": {
    "mediaId": "6a1f0c2e9b4d7a3e5c8b1d20",
    "upload": {
      "url": "https://api.cloudinary.com/v1_1/<cloud>/video/upload",
      "method": "POST",
      "fields": {
        "public_id": "private/addresses/unassigned/6a1f0c2e9b4d7a3e5c8b1d20", "type": "authenticated", "allowed_formats": "m4a,aac,mp4",
        "overwrite": "false", "timestamp": "1762340400", "api_key": "…", "signature": "…"
      },
      "expiresAt": "2026-11-05T10:40:00Z"
    }
  }
}
```
Send a multipart form with all `fields` first and the file last (field name `file`). The signature covers the file's place and format, so the app cannot upload elsewhere. The API secret is never sent. With S3 the same shape carries a presigned POST (`key`, `policy`, `x-amz-signature`) that also caps the size.

Cloudinary cannot cap the size of a signed upload, so the declared `sizeBytes` and `durationSec` are checked here, and the **real** size and length are measured again at `/media/complete`: an oversized or overlong file is deleted and refused there.

Errors: `422 UPLOAD_REJECTED` (`details.reason`: `type_not_allowed`, `too_large`, `too_long`, or `too_many_pending` when the caller already has 50 unfinished uploads) · `403 FORBIDDEN` (kind not allowed for your role) · `400 VALIDATION_ERROR` (bad body, `ownerRef` that does not fit the kind, voice note without `durationSec`) · `503 SERVICE_UNAVAILABLE` (storage is not configured or is down).

## POST /media/complete
Body: `{ "mediaId": "media_30" }`. Only the person who asked for the upload can complete it. The server confirms the file is there and measures it. With Cloudinary the file is `ready` at once (WebP sizes are made on demand from the delivery address); with S3 an image goes through `processing` while it is resized. Calling again is safe. 200:
```json
{ "data": { "mediaId": "media_30", "status": "ready", "kind": "address_voice", "contentType": "audio/mp4" } }
```
`status`: `pending` (not uploaded yet), `processing` (poll `GET /media/:id`), `ready`, `failed` (the file broke a size or length limit and was removed; nothing more to do). Errors: `409 CONFLICT` with `details.reason = "not_uploaded"` (nothing was uploaded yet; upload, then call again) · `422 UPLOAD_REJECTED` (`too_large` or `too_long` once measured) · `404 NOT_FOUND` · `503 SERVICE_UNAVAILABLE`.

## GET /media/:id
Readable by the person who uploaded the file, by anyone logged in once a public image is `ready`, and by staff who may see it; otherwise `403 FORBIDDEN`. 200 (public image, Cloudinary):
```json
{ "data": { "mediaId": "media_1", "status": "ready", "kind": "product_image", "urls": { "160": "https://res.cloudinary.com/<cloud>/image/upload/c_limit,w_160,f_webp,q_auto/public/products/prod_1/media_1.webp", "320": "…w_320…", "640": "…w_640…", "1080": "…w_1080…" } } }
```
Private files return no `urls`; use the next call. Only the owner, an assigned rider (for order media) or staff with the right permission can read a private file. Until the orders and dispatch modules exist, a rider can read only what they uploaded, and only staff whose scope is all warehouses can read other people's private files.

## GET /media/:id/url
200: `{ "data": { "url": "https://api.cloudinary.com/v1_1/<cloud>/video/download?…&expires_at=…&signature=…", "expiresAt": "2026-11-05T10:45:00Z" } }`. The URL is valid ~5 minutes: fetch it when needed. For a public image it answers the 1080 address with `expiresAt: null`. Errors: `403 FORBIDDEN` · `404 NOT_FOUND` · `410` is not used: an expired voice note returns `404` with `details.reason: "expired"` and the UI shows "voice note expired".

## DELETE /media/:id
Deletes my own address voice note or photo (customers), or a catalog, banner or rider image the caller may upload (staff). 200: `{ "data": { "ok": true } }`. The file is marked `deleting`, an audit entry is written, and the stored file and every size are removed straight away; if the provider fails, the deletion is retried with a growing wait and shows in the failed list below. Public files are also cleared from the provider's cache. Other kinds (order copies, evidence photos) cannot be deleted through the API: they expire on schedule. A product, category or banner image that is attached cannot be deleted here (`409 CONFLICT`, `details.reason = "in_use"`): remove it from its owner, for example [F04](F04-master-catalog.md) `DELETE /admin/products/:id/images/:mediaId`.

## Retention (server-side, no calls needed)
- Order voice notes and house photos are deleted **7 days after the order is delivered** (or cancelled). The order keeps its text fields; the app shows "voice note expired".
- Failed-delivery and refund photos are kept for `evidenceRetentionDays` (placeholder 90).
- The rider app deletes its cached voice and photo files after delivery and sync.

## GET /admin/media/failed · POST /admin/media/:id/retry-delete
List: `{ "data": [{ "mediaId": "media_77", "kind": "product_image", "status": "deleting", "attempts": 5, "error": "AccessDenied", "since": "2026-11-05T01:00:00Z" }] }`. Retry: the deletion is tried again at once and the result is returned: 200 `{ "data": { "status": "deleted" } }` when it worked, or `{ "status": "deleting" }` when it failed again. `409 CONFLICT` when the file is not waiting to be deleted. Both calls need `catalog:manage` and are audited.

## Implementation notes (backend, D2-3)

- **Providers.** `StorageProvider` (create a signed upload, measure a finished upload, public address, short-lived private address, copy, delete) has one implementation today, Cloudinary, written against its REST API with signed requests (no extra package). When no configuration is set, a stand-in answers `503` rather than pretending to work. Moving to S3 means adding an S3 implementation (a presigned POST, `sharp` to make the four WebP sizes into `public/…`, CloudFront invalidation) and changing the provider that composition picks.
- **Configuration.** Set `CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>`, or the three variables `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Optional `CLOUDINARY_DELIVERY_URL` serves public images from your own domain. Keep the secret out of git and out of the apps.
- **Public and private.** Public kinds are uploaded as normal Cloudinary files and served as resized WebP (`c_limit,w_<width>,f_webp,q_auto`) for 160, 320, 640 and 1080. In the Cloudinary console, restrict derived sizes to these ("Strict transformations") so nobody can request arbitrary ones. Private kinds are stored as `authenticated` files that have no public address; reads use a signed download that expires in about 5 minutes.
- **Keys** are random ids only: `public/products/<productId>/<mediaId>`, `public/categories/…`, `public/banners/…`, `private/riders/…`, `private/addresses/…`, `private/orders/<orderId>/…`, `private/evidence/<orderId>/…`. A file uploaded before its owner exists lives under `unassigned/`.
- **Attaching.** The catalog claims an image when it is added to a product, which stops one file belonging to two products and stops it being cleaned up as unused. A category image or private file cannot be attached to a product.
- **Order copies.** `copyToOrder` copies an address voice note or photo to `private/orders/<orderId>/…` once per source and order; repeated or simultaneous calls give the same copy. `scheduleOrderMediaExpiry` sets the delete time to the order's end plus `orderMediaRetentionDays` (7); `scheduleEvidenceExpiry` uses `evidenceRetentionDays` (90). Deleting the saved address file does not touch the order's copy. Dev 1 calls these from order placement and the order state machine.
- **Sweeper.** `sweep()` deletes files whose delete time has passed, retries deletions that failed (waiting 1, 2, 4... up to 60 minutes between tries), and removes uploads never finished, failed files and ready files never attached after 24 hours. The jobs module runs it every hour once the server calls `startBackground()` ([F23](F23-notifications.md#implementation-notes-backend-d2-2)).
- **Settings** are options of the module for now (5 MB images, 500 KB and 10 s voice notes, 7 and 90 retention days, 24 hours unattached, 50 unfinished uploads per person). They move to the settings store when F25 exists.
- **Known shortcuts.** There is no weekly sweep that compares the provider's files with the database: a file uploaded but never completed is found through its database row, but a file that exists with no row would stay. The `media:upload` and `media:delete_own` permission keys are not checked; the kind rules decide who may upload and delete. Auth: the routes take a resolver for the logged-in customer, rider or staff member; until the identity session is wired in, every route answers `401`.
