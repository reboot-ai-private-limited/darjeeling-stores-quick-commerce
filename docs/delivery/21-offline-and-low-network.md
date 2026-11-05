# F21 – Offline-First & Low-Network

Status: draft v3 · Folder: delivery · Depends on: F08, F10, F19 · See also: F15 (UPI QR), F20 (tracking), F24 (uploads)

Endpoints (rider bundle, sync queue, offline review) with request and response examples: [API · F21](../api/F21-offline-and-low-network.md).

Context: hilly region, 2G/3G and dead spots, budget phones. Goals: home screen under 1 s from cache, no blocking spinners on cart actions, and a rider who can finish a delivery with zero signal.

## 1. Customer app

### 1.1 Local storage (MMKV)

| Key | Content | Refresh |
|---|---|---|
| `zone` | `{zoneId, name, lastRev}` | On location or address change |
| `catalog:<zoneId>` | Categories and resolved product list (one price per product) | Delta sync |
| `cart` | Items and a local mutation queue | Every tap |
| `clientId`, `idemKey:<checkoutId>` | Device id, checkout idempotency key | Per checkout |
| `lastTracking:<orderId>` | Last known status, rider position, time | Each poll |
| `appConfig` | Min version, maintenance flag | App launch |

### 1.2 Delta sync
- Every `warehouse_products` row has a monotonic `rev` (from `counters`). Deletions and archiving stay as rows with `status` (tombstones).
- `GET /catalog/changes?zoneId=Z&since=<rev>` returns the zone's **resolved** product entries changed since `rev` (price, stock flag, status, new products) plus the new `rev`. A few KB.
- First launch downloads the full zone catalog once, paged by category; images lazy-load.
- Apps never see warehouse names: the server dedupes products across the zone's warehouses.
- Open app → render from MMKV → delta sync in the background → patch the list in place. If sync fails, keep the cache and show an "offline – prices may be outdated" chip; the server re-prices at quote time anyway.
- Hard reset of the cache on a too-large `rev` gap or `FULL_RESYNC`.

### 1.3 Optimistic cart
`+ ADD` / `−` update local state and MMKV in the same frame, with haptics (`expo-haptics`), no spinners. Mutations queue and send in the background (`PUT /cart` with the full cart and `clientRev`), last-writer-wins per line. The server's reply can trim lines; a non-blocking toast appears on the card. The cart is also stored server-side (F10).

### 1.4 Idempotent checkout
1. Opening the checkout sheet creates a `checkoutId` and `Idempotency-Key`, persisted in MMKV.
2. Fetch a quote (valid ~5 min). Offline → button disabled with "No connection".
3. Tap **Place Order** → `POST /orders {quoteId}` with the key. The button disables at once.
4. On timeout or network error **retry the same key**; the server returns the same order if it exists.
5. Clear the key only after a terminal response.

### 1.5 Tracking on a weak network
Poll every ~10 s while out for delivery (~30 s before), stop in the background or on a terminal state. On failure keep the last data and show "Updated 2 min ago". WhatsApp sends the **delivery OTP** and a **tracking link with an expiring token** in case the app does not load.

### 1.6 Images and uploads
Product images are pre-generated WebP widths in S3 behind CloudFront (F24); cards request the 320 width (≤ 30 KB). Voice note and house photo are compressed on the device and uploaded straight to S3 by a presigned URL with a retry queue; the order can be placed before the upload finishes.

## 2. Rider app

### 2.1 Pickup bundle (downloaded at the warehouse, where signal is good)
On **Picked up** the app downloads and stores (MMKV; queue in SQLite):

```
orderId, groupId, orderNo, items[], address{line, landmark, locality, location},
customer{name, phone}, voiceNoteFile, housePhoto (both removed from the device after delivery and sync),
amountDue, paymentMethod, paymentStatus,
otp: { salt, hash, algo, attemptsMax },     // NOT the plain OTP
upi: { vpa, payeeName }                      // warehouse business VPA
```

OTP hash: `PBKDF2/HMAC-SHA256(otp, salt)` per child order, same OTP code for the group. A 4-digit code has only 10,000 values, so the hash is **not** a real secret on a compromised device. It is a UI gate; the controls below make abuse detectable.

### 2.2 Offline delivery
1. At the door → **Arrived** (queued if offline).
2. The customer reads the 4-digit OTP; the rider enters it. The app checks it against `hash` locally; max 5 attempts, then locked until online.
3. COD: shows `amountDue`; rider picks **Cash collected** or **UPI QR**.
4. The app marks `DELIVERED` locally with `deliveredOffline = true`, `deviceTime` and GPS (lat/lng/accuracy). The entered OTP is stored encrypted in the event.
5. The event goes to the sync queue. The customer's "Delivered" message is sent **when the server receives the event**.

Server controls on sync:
- **Re-verifies the submitted OTP** against the real one (authoritative). Mismatch → order flagged `otp_mismatch`, admin review.
- Checks the rider was the assigned rider, GPS within `deliveryGeofenceMeters` of the address (flag, not reject, because hill GPS is poor), and device-time sanity.
- Every `deliveredOffline` order appears in an admin **Offline deliveries review** list; cash is reconciled normally.

### 2.3 Doorstep UPI QR (offline)
- Built on the device: `upi://pay?pa=<vpa>&pn=<payeeName>&am=<rupees>&cu=INR&tn=<orderNo>`; no API call.
- The app cannot confirm the payment; the rider taps **Customer paid via UPI** → `collection.method = upi_unverified`, **not** cash in hand. Admin reconciles with the bank (F15, F22).

### 2.4 Pay-link race
The server pushes `paymentStatus=paid` to the rider (FCM data message and the next assignments poll). If the rider is offline and collects anyway, the sync stores the entry as `overpaid` and the admin refunds the customer. The UI shows red **Already paid – do not collect** when it knows.

### 2.5 Location
Online with an order: ping ~10 s. Idle but online: ~60 s. Offline: buffer the last ~200 pings and upload as a batch on reconnect.

## 3. Sync queue (rider)

Storage: SQLite `outbox(seq, clientEventId, type, orderId, payload, deviceTime, gps, status, attempts)`; MMKV for bundles.

| Event `type` | Effect on server |
|---|---|
| `ack_assignment` | Assignment acknowledged |
| `picked_up`, `start_ride`, `arrived` | Status transitions |
| `deliver` / `deliver_offline` | Delivered (OTP re-checked) |
| `collect_cash`, `collect_upi_unverified` | Ledger entry / unverified UPI record |
| `failed_delivery` | Failed delivery with reason and photo ref |
| `location_batch` | Buffered pings |

Rules:
- Events are sent **in `seq` order**, in batches: `POST /rider/sync {events[]}`.
- Idempotent by `clientEventId` (UUID, unique in `offline_events`); replays return the stored result.
- Per-event result: `applied`, `duplicate` or `conflict{reason}`. Conflicts (cancelled, reassigned, already delivered) never silently drop data: the event is stored, the rider sees an explanation, and the admin gets an alert. Cash collected on a cancelled or reassigned order is recorded as `unmatched` in the ledger.
- Triggers: app foreground, NetInfo reconnect, every 30 s while events exist, after each action. Exponential backoff with a cap.
- A badge shows "N pending sync"; end of shift is blocked while the outbox is not empty (admin can override).
- Uploads (failed-delivery photo) use the same retry mechanism, separate from events.

## 4. Admin panel
The dispatch board and order list poll `GET /admin/orders/changes?since=<cursor>` every ~5 s (pause when the tab is hidden, resume with a full refetch). A failed poll keeps the last data and shows a "reconnecting" chip. The new-order bell needs a user click first (browser autoplay rule): an "Enable sound" button on login.

## 5. Failure matrix

| Situation | Customer | Rider | Admin |
|---|---|---|---|
| No network at home screen | Cached catalog, outdated chip | – | – |
| Double-tap Place Order | One order | – | – |
| Payment succeeded, app dead | WhatsApp confirmation (webhook-driven) | – | – |
| Rider in dead spot at the door | "Updated X ago" | Offline OTP and sync | Flag review if OTP or GPS is odd |
| Rider phone dies | Stale position | – | Idle alert → handover (F18) |
| Sync conflict | – | Explanation shown | Alert and resolution list |
| Voice note upload pending | – | Note arrives later, landmark available | – |

## 6. Data
**offline_events**: `riderId`, `clientEventId` (unique), `seq`, `type`, `orderId`, `payload`, `deviceTime`, `gps`, `receivedAt`, `result` (`applied, duplicate, conflict`), `conflictReason?`.

## 7. Settings
`deliveryGeofenceMeters` (300) · local OTP attempts max (5) · `quoteValiditySeconds`.

## 8. Permissions
`rider_sync:push`, `catalog:changes` (guest), `rider_order:verify_delivery_otp`.

## 9. Open questions
1. Confirm that a business UPI VPA is available for doorstep QR.
2. Mobile storage for the SQLite outbox: `expo-sqlite` vs another option (decide at build).
