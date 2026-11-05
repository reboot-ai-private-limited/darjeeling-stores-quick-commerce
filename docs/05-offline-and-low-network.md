# 05 – Offline-First & Low-Network Design

Status: draft v1 · Depends on: `PLAN.md`, `02-workflows.md`, `03-erd.md`

Context: hilly region, 2G/3G and dead spots, budget phones. Goals: home screen < 1 s on cached data, no blocking spinners on cart actions, rider can finish a delivery with zero signal.

## 1. Customer app

### 1.1 Local storage (MMKV)
| Key | Content | Refresh |
|---|---|---|
| `zone` | `{zoneId, name, lastRev}` | On location/address change |
| `catalog:<zoneId>` | Categories + resolved product list (one price per product) | Delta sync |
| `cart` | Items `{productId, variantId, qty}` + local mutation queue | Every tap |
| `clientId`, `idemKey:<checkoutId>` | Device id, checkout idempotency key | Per checkout |
| `lastTracking:<orderId>` | Last known status/rider position/time | Each poll |
| `appConfig` | min version, maintenance flag | App launch |

### 1.2 Delta sync
- Every `warehouse_products` row has a monotonic `rev` (from `counters`). Deletions/archiving are kept as rows with `status` (tombstones).
- `GET /catalog/changes?zoneId=Z&since=<rev>` returns the zone's **resolved** product entries changed since `rev` (price, stock flag, status, new products) plus `rev` to store. Payload is a few KB.
- First launch (no cache) downloads the full zone catalog once, paginated by category; images lazy-load.
- Apps never see warehouse names: the server dedupes products across the zone's warehouses (same price rule guarantees one price). Availability = in stock in at least one open warehouse.
- Open app → render from MMKV immediately → delta sync in background → patch list in place. If sync fails, keep the cache and show a small "offline – prices may be outdated" chip; the server re-prices at quote time anyway.
- Hard reset of the cache if `rev` gap is too large or the server says `FULL_RESYNC`.

### 1.3 Optimistic cart
- `+ ADD` / `−` update local state and MMKV in the same frame, with haptic (`expo-haptics`). No spinners.
- Mutations are queued and sent in the background (`PUT /cart` with full cart + `clientRev`); last-writer-wins per line. The server's reply can trim lines (out of stock, max qty): show a non-blocking toast on the affected card.
- The cart is also stored server-side (needed for abandoned-cart reminders and zone changes).

### 1.4 Idempotent checkout
1. Open the checkout sheet → create `checkoutId` + `Idempotency-Key`, persist in MMKV.
2. Fetch a **quote** (bill, ETA, valid ~5 min). Offline → button disabled with "No connection".
3. Tap **Place Order** → `POST /orders {quoteId}` with the key. The button disables immediately.
4. On timeout/network error: **retry the same key**. The server returns the same order if it already exists.
5. Clear the key only after a terminal response (success or definite rejection).

### 1.5 Tracking on a weak network
- Poll every ~10 s while out for delivery (~30 s before), stop in background or on terminal state.
- On failure keep last known data and show "Updated 2 min ago". The map marker animates between points client-side.
- WhatsApp sends the **delivery OTP** and a **tracking link with an expiring token** (works without logging in) in case the app won't load.

### 1.6 Images
Product images are pre-generated WebP widths (160 / 320 / 640 / 1080) in S3 behind CloudFront (`06` §3); list cards request the 320 width, target ≤ 30 KB; skeleton shimmers only; `expo-image` disk cache (or FastImage if maintained). FlashList for all lists.

### 1.7 Address system (hills)
- GPS pin + zone check (`POST /zones/check`).
- **Locality dropdown** (from `localities` of the zone's city) – required.
- **Landmark** – required. Optional **10-second voice note** and **house photo**: compressed on device, uploaded straight to S3 through a presigned URL with a retry queue (the order can be placed before the upload finishes; the file attaches when it lands). The order gets its own copy; the voice note is deleted 7 days after delivery (`06` §5).
- Pin accuracy warning if GPS accuracy is poor; the landmark text is what riders rely on.

## 2. Rider app

### 2.1 Alarm & assignment
- Assignment push is an FCM **high-priority data message**; the app (Notifee) shows a **full-screen alarm** with sound until acknowledged. No reject button; **Acknowledge** posts the ack (queued if offline).
- Requires: full-screen-intent permission (Android 14+), exclusion from battery optimisation, notification channel at max importance – checked during onboarding and on every shift start.
- No ack within 2 min → server sends WhatsApp to the rider and alerts admin.

### 2.2 Pickup bundle (downloaded at the warehouse, where signal is good)
On **Picked up** for each order, the app downloads and stores (MMKV; queue in SQLite):

```
orderId, groupId, orderNo, items[], address{line, landmark, locality, location},
customer{name, phone}, voiceNoteFile (cached audio), housePhoto (cached; both removed from the device after delivery + sync),
amountDue, paymentMethod, paymentStatus,
otp: { salt, hash, algo, attemptsMax },     // NOT the plain OTP
upi: { vpa, payeeName }                      // warehouse's business VPA
```

OTP hash: `PBKDF2/HMAC-SHA256(otp, salt)` (per child order, same OTP code for the group). A 4-digit code has only 10,000 values, so the hash is **not** a real secret on a compromised device. It is a UI gate; controls below make abuse detectable.

### 2.3 Offline delivery
1. Rider reaches the door → taps **Arrived** (queued if offline).
2. Customer reads the 4-digit OTP; the rider enters it. App checks it against `hash` locally; max 5 attempts, then locked until online.
3. COD: shows `amountDue`; rider chooses **Cash collected** or **UPI QR** (§2.4).
4. App marks `DELIVERED` locally with `deliveredOffline = true`, `deviceTime`, GPS (lat/lng/accuracy). The entered OTP is stored encrypted in the event.
5. The event goes to the sync queue (§3). The customer's "Delivered" message is sent **when the server receives the event**, not before.

Server controls on sync:
- **Re-verifies the submitted OTP** against the real one (authoritative). Mismatch → order flagged `otp_mismatch`, admin review.
- Checks the rider was the assigned rider, GPS within `deliveryGeofenceMeters` of the address (flag, not reject, because hill GPS is poor), device time sanity vs server receive time.
- Every `deliveredOffline` order appears in an admin **Offline deliveries review** list; cash is reconciled normally.

### 2.4 Doorstep UPI QR (offline)
- Built on device from the bundle: `upi://pay?pa=<vpa>&pn=<payeeName>&am=<amount in rupees, 2 decimals>&cu=INR&tn=<orderNo>`; rendered with a QR component. No API call.
- The app cannot confirm the payment. The rider taps **Customer paid via UPI** and the entry is saved as `collection.method = upi_unverified`. It is **not** cash in hand.
- Admin reconciles with the bank statement/UPI app (list: order, amount, rider, time) and marks `upi_verified` or raises a discrepancy.
- Use a **business** UPI ID (a personal VPA for commercial collection may breach UPI rules – confirm with your bank). Where online, the app can instead show a Razorpay QR/payment link (verifiable).

### 2.5 Pay-link race (customer pays online while rider has the order)
Server pushes `paymentStatus=paid` to the rider (FCM data message, and on the next assignments poll). If the rider is offline and collects cash anyway, the sync reports `collection` on an order that is already paid → entry saved as `overpaid`, admin task to refund the customer. The rider UI shows a red **Already paid – do not collect** when it knows.

### 2.6 Location
- Online with an order: ping every ~10 s. Idle but online: ~60 s.
- Offline: buffer pings (last ~200) and upload as a batch on reconnect; the server keeps only the latest as `lastLocation` unless the trail is enabled.

## 3. Sync queue (rider)

Storage: SQLite table `outbox(seq, clientEventId, type, orderId, payload, deviceTime, gps, status, attempts)`; MMKV for the order bundles.

| Event `type` | Effect on server |
|---|---|
| `ack_assignment` | Assignment acknowledged |
| `picked_up`, `start_ride`, `arrived` | Status transitions |
| `deliver` / `deliver_offline` | Delivered (with OTP check on server) |
| `collect_cash`, `collect_upi_unverified` | Ledger entry / unverified UPI record |
| `failed_delivery` | Failed delivery with reason/photo ref |
| `location_batch` | Buffered pings |

Rules:
- Events are sent **in `seq` order**, one batch per request: `POST /rider/sync {events[]}`.
- Idempotent by `clientEventId` (UUID, unique in `offline_events`); replays return the stored result.
- Per event result: `applied`, `duplicate`, or `conflict{reason}`. Conflicts (order cancelled, reassigned, already delivered) never silently drop data: the event is stored, the rider sees an explanation, and the admin gets an alert. Cash collected on a cancelled/reassigned order is recorded as `unmatched` in the ledger for admin resolution.
- Triggers: app foreground, NetInfo reconnect, every 30 s while events exist, after each user action. Exponential backoff with a cap.
- A badge shows "N pending sync"; end of shift is blocked while the outbox is not empty (admin can override).
- Uploads (failed-delivery photo) go through the same retry mechanism, separately from events (event carries a placeholder; file attaches later).

## 4. Admin panel
- The dispatch board and order list poll `GET /admin/orders/changes?since=<cursor>` every ~5 s (pause when the tab is hidden, resume with a full refetch). A failed poll keeps the last data and shows a "reconnecting" chip.
- The new-order bell needs a user interaction on the page first (browser autoplay rule): include an "Enable sound" button on login.

## 5. Failure matrix

| Situation | Customer | Rider | Admin |
|---|---|---|---|
| No network at home screen | Cached catalog, outdated chip | – | – |
| Double-tap Place Order | One order (idempotency) | – | – |
| Payment succeeded, app dead | WhatsApp confirmation (webhook-driven) | – | – |
| Rider in dead spot at door | "Updated X ago" | Offline OTP + sync | Flag review if OTP/GPS odd |
| Rider phone dies | Stale position | – | Idle alert → handover flow |
| Sync conflict | – | Explanation shown | Alert + resolution list |
| Voice note upload pending | – | Note arrives later; landmark available | – |
