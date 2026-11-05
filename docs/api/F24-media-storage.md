# API · F24 Media Storage (S3)

Spec: [F24](../platform/24-media-storage.md) · Conventions: [00](00-conventions.md)

Files go **straight from the app to S3** with a presigned upload; the API only issues the permission and processes the result. Other endpoints store a `mediaId`, never a URL.

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
Body:
```json
{ "kind": "address_voice", "contentType": "audio/mp4", "sizeBytes": 84210, "durationSec": 8, "ownerRef": { "type": "address", "id": "addr_1" } }
```
`ownerRef` is optional when the file is attached later (for example a new address). 201:
```json
{
  "data": {
    "mediaId": "media_30",
    "upload": {
      "url": "https://dsqc-media.s3.ap-south-1.amazonaws.com/",
      "method": "POST",
      "fields": { "key": "tmp/media_30", "Content-Type": "audio/mp4", "policy": "eyJ…", "x-amz-signature": "…" },
      "expiresAt": "2026-11-05T10:40:00Z"
    }
  }
}
```
Send a multipart form with all `fields` first and the file last. The server limits file size and type in the signed policy.

Errors: `422 UPLOAD_REJECTED` (`details.reason`: `type_not_allowed`, `too_large`, `too_long`) · `403 FORBIDDEN` (kind not allowed for your role).

## POST /media/complete
Body: `{ "mediaId": "media_30" }`. Images are processed in the background (resized to WebP). 200:
```json
{ "data": { "mediaId": "media_30", "status": "ready", "kind": "address_voice", "contentType": "audio/mp4" } }
```
`status`: `pending` (not uploaded yet), `processing` (image resizing: poll `GET /media/:id`), `ready`, `failed`. Errors: `409 CONFLICT` (nothing was uploaded) · `404 NOT_FOUND`.

## GET /media/:id
200 (public image):
```json
{ "data": { "mediaId": "media_1", "status": "ready", "kind": "product_image", "urls": { "160": "https://cdn.example.com/public/products/prod_1/media_1/160.webp", "320": "…/320.webp", "640": "…/640.webp", "1080": "…/1080.webp" } } }
```
Private files return no `urls`; use the next call. Only the owner, an assigned rider (for order media) or staff in scope can read a private file.

## GET /media/:id/url
200: `{ "data": { "url": "https://dsqc-media.s3…?X-Amz-Signature=…", "expiresAt": "2026-11-05T10:45:00Z" } }`. The URL is valid ~5 minutes: fetch it when needed. Errors: `403 FORBIDDEN` · `404 NOT_FOUND` · `410` is not used: an expired voice note returns `404` with `details.reason: "expired"` and the UI shows "voice note expired".

## DELETE /media/:id
Deletes my own address voice note or photo (customers) or any catalog image (staff with permission). 200: `{ "data": { "ok": true } }`. All sizes are removed from S3 by a background job and CloudFront is invalidated for public files. Catalog image removal also has its own endpoint ([F04](F04-master-catalog.md)).

## Retention (server-side, no calls needed)
- Order voice notes and house photos are deleted **7 days after the order is delivered** (or cancelled). The order keeps its text fields; the app shows "voice note expired".
- Failed-delivery and refund photos are kept for `evidenceRetentionDays` (placeholder 90).
- The rider app deletes its cached voice and photo files after delivery and sync.

## GET /admin/media/failed · POST /admin/media/:id/retry-delete
List: `{ "data": [{ "mediaId": "media_77", "kind": "product_image", "status": "deleting", "attempts": 5, "error": "AccessDenied", "since": "2026-11-05T01:00:00Z" }] }`. Retry: 200 `{ "data": { "status": "deleting" } }`.
