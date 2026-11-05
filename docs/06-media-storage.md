# 06 – Media Storage (AWS S3)

Status: draft v1 · Depends on: `PLAN.md`, `03-erd.md`, `05-offline-and-low-network.md`

Goals: all images, voice notes and photos live in S3; **a file removed in the app is removed from S3**; **voice notes are deleted 7 days after the order is delivered**; no orphaned files.

## 1. File kinds

| Kind (`media_files.kind`) | S3 prefix | Access | Processing | Lifetime |
|---|---|---|---|---|
| `product_image` | `public/products/<productId>/<mediaId>/` | Public via CloudFront | WebP sizes (below) | Until admin removes/replaces it, or the product is permanently deleted |
| `category_image`, `banner` | `public/categories/…`, `public/banners/…` | Public via CloudFront | WebP sizes | Until removed/replaced |
| `rider_photo` | `private/riders/<riderId>/` | Private (presigned GET) | Resize 512 px | Until replaced or rider removed |
| `address_voice`, `address_photo` | `private/addresses/<addressId>/` | Private | Voice as uploaded; photo resized 1080 px | Until the customer deletes/replaces it, or the address/account is deleted |
| `order_voice`, `order_photo` | `private/orders/<orderId>/` | Private | Server-side **copy** of the address file at order placement (or uploaded at checkout) | **Deleted `orderMediaRetentionDays` (7) days after the order is delivered** (cancelled/failed-closed orders: 7 days after that terminal state) |
| `failed_delivery_photo`, `refund_photo` | `private/evidence/<orderId>/` | Private | Resize 1080 px | `evidenceRetentionDays` after the order closes (placeholder 90 – kept for disputes; admin setting) |
| `upload_tmp` | `tmp/` | Private | – | Deleted after processing; S3 lifecycle expires leftovers after 1 day |

Keys use random ids only (no phone numbers or names).

## 2. Buckets & access

- One private bucket, **Block Public Access ON**. Public product/banner/category images are served through **CloudFront** (Origin Access Control); everything under `private/` is never public.
- Private files: the API issues **presigned GET URLs** (~5 min) after a permission check (customer owns the order; rider is assigned; admin has scope). The rider app downloads voice/photo into its offline bundle at pickup.
- Uploads: client asks `POST /media/upload-url {kind, contentType, size, ownerRef}` → server validates (type allow-list, max size: image 5 MB, voice 500 KB / 10 s, photo 5 MB) → returns a **presigned POST** with content-length-range and content-type conditions to `tmp/` → client uploads directly to S3 (retry queue on weak network) → `POST /media/complete {mediaId}` → server processes and moves to the final prefix.
- Encryption at rest (SSE-S3), HTTPS only, CORS limited to the web origin, IAM user/role for the API with least privilege (`PutObject`, `GetObject`, `DeleteObject`, `CopyObject` on this bucket only; CloudFront invalidation permission).
- **Versioning stays OFF** (otherwise "delete" only adds a delete marker and the bytes remain). If versioning is ever turned on, add a lifecycle rule that expires non-current versions after 1 day.

## 3. Image pipeline (product, category, banner)

1. Admin picks an image in the Next.js panel → upload to `tmp/` (presigned).
2. API job (`sharp`) generates WebP at widths **160 / 320 / 640 / 1080** with quality tuned so the **card size (320) is ≤ 30 KB**; strips metadata; stores `public/…/<mediaId>/<width>.webp`; deletes the `tmp` object.
3. DB stores `mediaId` and the list of variant keys in `media_files` (not full URLs). URLs = `CLOUDFRONT_DOMAIN + key`. Cache headers: long (`immutable`) because keys contain the `mediaId` (a new image gets a new key).
4. Apps request the width they need (list cards use 320). There is no on-the-fly resizing service, so only these widths exist.

## 4. Deletion

All deletes go through one function, `mediaService.remove(mediaId, reason)`:

1. Set `media_files.status = deleting` and write `audit_log` (who, what, why).
2. Enqueue a `delete_media` job (Mongo `jobs`, retried with backoff).
3. Job calls S3 `DeleteObjects` for **every variant key** of the file (all WebP widths, or the single object), then for public files creates a **CloudFront invalidation** for those paths.
4. On success: `status = deleted`, `deletedAt`, keys cleared from the file row. On repeated failure: alert admin (the file stays `deleting` and visible in a "Failed deletions" list).

Triggers:

| Trigger | What gets deleted |
|---|---|
| Admin removes a product/banner/category image | That image |
| Admin replaces an image | The old image, **after** the new one is saved |
| Product permanently deleted (only if never ordered; otherwise it is archived and **keeps** its images for order history) | All its images |
| Customer deletes/replaces an address voice note or photo | That file |
| Address deleted | Its voice note and photo (unless an active order still uses a copy – the copy is separate, see below) |
| Account deletion finalised | All address and order media of the user |
| Rider removed or photo replaced | Old photo |
| Scheduled expiry (`deleteAfter` reached) | Order voice/photo copies, evidence photos |

Backstops (in case a job is missed):
- **Hourly sweeper:** finds `media_files` with `deleteAfter <= now` and `status = ready`, and any stuck in `deleting`, and runs the delete.
- **Weekly orphan sweep:** compares S3 keys under `public/` and `private/` with `media_files`; objects with no row, or rows never attached to an owner for 24 h, are deleted.
- **S3 lifecycle rules:** `tmp/` expires after 1 day; abort incomplete multipart uploads after 1 day; `private/orders/` expires at 30 days after creation as a hard safety net (the exact 7-days-after-delivery deletion is done by the sweeper).

## 5. Voice notes and order photos (7-day rule)

1. Customer records a ≤ 10 s note at checkout (or reuses a saved address note). At order placement the server **copies** the file to `private/orders/<orderId>/` as an `order_voice` row (same for the house photo → `order_photo`). Deleting or editing the address note later does not affect the order, and vice versa.
2. The rider sees the order copy (presigned GET; cached in the offline bundle).
3. When the child order becomes `DELIVERED` (set when the event syncs for offline deliveries), set `deleteAfter = deliveredAt + orderMediaRetentionDays` (default **7 days**, a setting) on its order media.
4. For `CANCELLED` orders: `deleteAfter = cancelledAt + 7 days`. `FAILED_DELIVERY` that is re-dispatched keeps its media; the clock starts only at the final terminal state.
5. For split groups each child has its own copy and its own clock.
6. At expiry the sweeper runs the standard delete (§4). The order keeps its text fields (landmark, notes); the UI shows "voice note expired".
7. **Rider device:** the app deletes cached voice/photo files from local storage once the order is delivered and synced (and any older than 7 days at app start).
8. Pre-orders: the clock starts at delivery, not at placement.

## 6. Data model

`media_files` (see `03-erd.md` §6, `media_files`): `kind`, `ownerType`, `ownerId`, `keys[]` (`{width?, key, bytes}`), `contentType`, `status` (`pending, ready, deleting, deleted`), `uploadedBy`, `deleteAfter?`, `deletedAt?`, `copiedFromId?`. Other collections store only `mediaId` references.

## 7. Settings

| Key | Scope | Placeholder |
|---|---|---|
| `media.orderMediaRetentionDays` (voice + house photo copies) | global | **7** |
| `media.evidenceRetentionDays` (failed-delivery and refund photos) | global | 90 |
| `media.maxImageMB`, `media.maxVoiceSeconds`, `media.maxVoiceKB` | global | 5 / 10 / 500 |

## 8. Open points

1. Should a saved **address-level** voice note/photo exist at all, or only per-order notes (re-recorded or picked from the device each time)? Default: address-level files are allowed and customer-controlled; the order gets its own copy that is deleted after 7 days.
2. House photo: delete with the voice note after 7 days (default above), or keep until the customer removes it?
3. Evidence photos (failed delivery, refund proof): 90 days placeholder – confirm.
4. Cost note: S3 + CloudFront at this scale is small, but there is no image resizing on the fly; supporting a new width later means re-processing existing images (a one-off script).
