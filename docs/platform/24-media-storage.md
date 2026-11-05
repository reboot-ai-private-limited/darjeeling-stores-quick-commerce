# F24 – Media Storage (AWS S3)

Status: draft v3 · Folder: platform · Depends on: F04, F09 · See also: F13 (order media copies), F21 (uploads on weak network)

Goals: all images, voice notes and photos live in S3; **a file removed in the app is removed from S3**; **voice notes are deleted 7 days after the order is delivered**; no orphaned files.

## 1. File kinds

| Kind (`media_files.kind`) | S3 prefix | Access | Processing | Lifetime |
|---|---|---|---|---|
| `product_image` | `public/products/<productId>/<mediaId>/` | Public via CloudFront | WebP sizes (§3) | Until the admin removes or replaces it, or the product is permanently deleted |
| `category_image`, `banner` | `public/categories/…`, `public/banners/…` | Public via CloudFront | WebP sizes | Until removed or replaced |
| `rider_photo` | `private/riders/<riderId>/` | Private (presigned GET) | Resize 512 px | Until replaced or rider removed |
| `address_voice`, `address_photo` | `private/addresses/<addressId>/` | Private | Voice as uploaded; photo resized 1080 px | Until the customer deletes or replaces it, or the address or account is deleted |
| `order_voice`, `order_photo` | `private/orders/<orderId>/` | Private | Server-side **copy** of the address file at placement (or uploaded at checkout) | **Deleted `orderMediaRetentionDays` (7) days after the order is delivered** (cancelled or closed-failed: 7 days after that) |
| `failed_delivery_photo`, `refund_photo` | `private/evidence/<orderId>/` | Private | Resize 1080 px | `evidenceRetentionDays` after the order closes (placeholder 90, kept for disputes) |
| `upload_tmp` | `tmp/` | Private | – | Deleted after processing; S3 lifecycle expires leftovers after 1 day |

Keys use random ids only (no phone numbers or names).

## 2. Buckets and access

- One private bucket, **Block Public Access ON**. Public product, banner and category images are served through **CloudFront** (Origin Access Control). Everything under `private/` is never public.
- Private files: the API issues **presigned GET URLs** (~5 min) after a permission check (customer owns the order, rider is assigned, admin has scope). The rider app downloads voice and photo into its offline bundle at pickup (F21).
- Uploads: the client calls `POST /media/upload-url {kind, contentType, size, ownerRef}` → the server validates (type allow-list, max size: image 5 MB, voice 500 KB / 10 s, photo 5 MB) → returns a **presigned POST** with content-length-range and content-type conditions to `tmp/` → the client uploads straight to S3 (retry queue on weak network) → `POST /media/complete {mediaId}` → the server processes and moves it to the final prefix.
- Encryption at rest (SSE-S3), HTTPS only, CORS limited to the web origin, a least-privilege IAM role for the API (`PutObject`, `GetObject`, `DeleteObject`, `CopyObject` on this bucket, CloudFront invalidation).
- **Versioning stays OFF** (otherwise "delete" only adds a delete marker and the bytes remain). If versioning is ever turned on, add a lifecycle rule that expires non-current versions after 1 day.

## 3. Image pipeline (product, category, banner)

1. Admin picks an image in the Next.js panel → upload to `tmp/` (presigned).
2. An API job (`sharp`) generates WebP at widths **160 / 320 / 640 / 1080**, quality tuned so the **320 card size is ≤ 30 KB**, strips metadata, writes `public/…/<mediaId>/<width>.webp`, and deletes the `tmp` object.
3. The DB stores the `mediaId` and the variant keys in `media_files` (not URLs). URL = `CLOUDFRONT_DOMAIN + key`. Cache headers are long (`immutable`) because keys contain the `mediaId`.
4. Apps request the width they need (cards use 320). There is no on-the-fly resizing, so only these widths exist; adding a width later means a one-off re-processing script.

## 4. Deletion

All deletes go through `mediaService.remove(mediaId, reason)`:

1. Set `media_files.status = deleting` and write `audit_log` (who, what, why).
2. Enqueue a `delete_media` job (Mongo `jobs`, retried with backoff).
3. The job calls S3 `DeleteObjects` for **every variant key** (all WebP widths, or the single object), then for public files creates a **CloudFront invalidation** for those paths.
4. On success: `status = deleted`, `deletedAt`, keys cleared. On repeated failure: alert the admin; the file stays `deleting` and appears in a "Failed deletions" list.

| Trigger | What gets deleted |
|---|---|
| Admin removes a product, banner or category image | That image |
| Admin replaces an image | The old image, **after** the new one is saved |
| Product permanently deleted (only if never ordered; otherwise archived and keeps its images) | All its images |
| Customer deletes or replaces an address voice note or photo | That file |
| Address deleted | Its voice note and photo (order copies are separate) |
| Account deletion finalised | All address and order media of the user |
| Rider removed or photo replaced | Old photo |
| Scheduled expiry (`deleteAfter` reached) | Order voice and photo copies, evidence photos |

Backstops:
- **Hourly sweeper:** finds `media_files` with `deleteAfter <= now` and `status = ready`, and any stuck in `deleting`, and runs the delete.
- **Weekly orphan sweep:** compares S3 keys under `public/` and `private/` with `media_files`; objects with no row, or rows never attached to an owner for 24 h, are deleted.
- **S3 lifecycle rules:** `tmp/` expires after 1 day; abort incomplete multipart uploads after 1 day; `private/orders/` expires 30 days after creation as a hard safety net (the exact 7-days-after-delivery delete is done by the sweeper).

## 5. Voice notes and order photos (7-day rule)

1. The customer records a ≤ 10 s note at checkout (or reuses a saved address note). At placement the server **copies** the file to `private/orders/<orderId>/` as an `order_voice` row (same for the house photo → `order_photo`). Editing or deleting the address note later does not affect the order, and the reverse.
2. The rider sees the order copy (presigned GET; cached in the offline bundle).
3. When the child order becomes `DELIVERED` (set when the event syncs for offline deliveries), set `deleteAfter = deliveredAt + orderMediaRetentionDays` (default **7 days**, a setting).
4. `CANCELLED` orders: `deleteAfter = cancelledAt + 7 days`. A `FAILED_DELIVERY` that is re-dispatched keeps its media; the clock starts at the final terminal state.
5. Split groups: each child has its own copy and its own clock.
6. At expiry the sweeper runs the standard delete (§4). The order keeps its text fields (landmark, notes); the UI shows "voice note expired".
7. **Rider device:** the app deletes cached voice and photo files after delivery and sync, and any older than 7 days at app start.
8. Pre-orders: the clock starts at delivery, not at placement.

## 6. Screens
- **Admin:** image uploader in product, category and banner editors · "Failed deletions" list · media settings.
- **Customer:** voice recorder (10 s), photo picker, delete buttons on the address form (F09).
- **Rider:** voice note player (F19).

## 7. API
Full request and response reference with examples: [API · F24](../api/F24-media-storage.md).

`POST /media/upload-url` · `POST /media/complete` · `GET /media/:id/url` (presigned GET) · `DELETE /media/:id` · admin `GET /admin/media/failed`.

## 8. Data
**media_files**: `kind` (`product_image, category_image, banner, rider_photo, address_voice, address_photo, order_voice, order_photo, failed_delivery_photo, refund_photo`), `ownerType`, `ownerId`, `keys[{width?, key, bytes}]`, `contentType`, `status` (`pending, ready, deleting, deleted`), `deleteAfter?`, `copiedFromId?`, `uploadedBy`, `deletedAt?`. Indexes `(status, deleteAfter)`, `(ownerType, ownerId)`.
Other collections store only `mediaId`.

## 9. Settings

| Key | Scope | Placeholder |
|---|---|---|
| `media.orderMediaRetentionDays` (voice + house photo copies) | global | **7** |
| `media.evidenceRetentionDays` (failed-delivery and refund photos) | global | 90 |
| `media.maxImageMB`, `media.maxVoiceSeconds`, `media.maxVoiceKB` | global | 5 / 10 / 500 |

## 10. Permissions
`media:upload`, `media:delete_own` (customer); `catalog:manage` for catalog images.

## 11. Open questions
1. Should a saved address keep a voice note and photo at all, or only per-order notes? Default: address-level allowed, order gets its own copy deleted after 7 days.
2. House photo: delete with the voice note after 7 days (default), or keep until the customer removes it?
3. Evidence photos: 90 days placeholder, confirm.
4. Voice notes and location are personal data: privacy policy, consent and retention under India's data protection law (lawyer).
