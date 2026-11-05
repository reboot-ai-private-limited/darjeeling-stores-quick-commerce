# API · F21 Offline-First & Low Network

Spec: [F21](../delivery/21-offline-and-low-network.md) · Conventions: [00](00-conventions.md)

Two pieces: the **customer delta sync** (`GET /catalog/changes`, documented in [F08](F08-discovery-and-location.md)) and the **rider pickup bundle and sync queue** below. Checkout idempotency is `Idempotency-Key` on `POST /orders` ([F13](F13-order-placement-and-split-orders.md)).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/rider/orders/:id/bundle` | Rider | Download everything needed to deliver offline |
| `POST` | `/rider/sync` | Rider | Upload the offline event queue in order |
| `GET` | `/admin/offline-reviews` | Admin `orders:manage` | Offline deliveries waiting for review |
| `POST` | `/admin/offline-reviews/:orderId/resolve` | Admin `orders:manage` | Close a review 🔒 |

## GET /rider/orders/:id/bundle
Call it right after `POST /rider/orders/:id/pickup`, while the rider is at the warehouse with good signal. Store it in MMKV; keep the outbox in SQLite. 200:
```json
{
  "data": {
    "orderId": "ord_1",
    "orderNo": "DS-240001-A",
    "groupId": "grp_1",
    "items": [{ "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "qty": 2 }],
    "address": { "line1": "Cedar Villa, 2nd floor", "landmark": "Opposite Planters Club gate", "locality": "Chowrasta", "location": { "lat": 27.0410, "lng": 88.2663 }, "deliveryNotes": "Ring the bell twice" },
    "customer": { "name": "Asha Rai", "phone": "+919876543210" },
    "voiceNote": { "mediaId": "media_60", "url": "https://s3…/signed", "expiresAt": "2026-11-05T11:20:00Z" },
    "housePhoto": { "mediaId": "media_61", "url": "https://s3…/signed", "expiresAt": "2026-11-05T11:20:00Z" },
    "amountDue": 8800,
    "paymentMethod": "cod",
    "paymentStatus": "cod_pending",
    "otp": { "salt": "b64:Qm9u…", "hash": "b64:7Hk2…", "algo": "pbkdf2-sha256", "iterations": 100000, "attemptsMax": 5 },
    "upi": { "vpa": "darjeelingstores@bank", "payeeName": "Darjeeling Stores" },
    "geofenceMeters": 300,
    "serverTime": "2026-11-05T10:44:05Z"
  }
}
```
- `otp` has a **salted hash only**, never the plain code. The app checks the OTP the customer reads out against this hash. A 4-digit code can be guessed offline, so the server re-checks it on sync (below).
- Download the signed voice-note and photo URLs now and cache the files; they expire. Delete them from the phone after the order is delivered and synced.
- `upi` lets the app build a doorstep QR with no network: `upi://pay?pa=<vpa>&pn=<payeeName>&am=<rupees>&cu=INR&tn=<orderNo>`.

Errors: `404 NOT_FOUND` (not your order) · `409 INVALID_TRANSITION` (not picked up yet).

## POST /rider/sync
Send the outbox in **sequence order**. Each event is applied once, however often it is replayed. Body:
```json
{
  "events": [
    { "clientEventId": "c0a8…-01", "seq": 41, "type": "arrived", "orderId": "ord_1", "deviceTime": "2026-11-05T11:01:50Z", "gps": { "lat": 27.0410, "lng": 88.2663, "accuracyM": 30 }, "payload": {} },
    { "clientEventId": "c0a8…-02", "seq": 42, "type": "collect_cash", "orderId": "ord_1", "deviceTime": "2026-11-05T11:02:05Z", "gps": { "lat": 27.0410, "lng": 88.2663, "accuracyM": 30 }, "payload": { "amount": 8800 } },
    { "clientEventId": "c0a8…-03", "seq": 43, "type": "deliver_offline", "orderId": "ord_1", "deviceTime": "2026-11-05T11:02:10Z", "gps": { "lat": 27.0410, "lng": 88.2663, "accuracyM": 30 }, "payload": { "otp": "4271", "otpCheckedLocally": true } }
  ]
}
```
`clientEventId` is a UUID the app makes once per event. Send at most ~50 events per call.

### Event types and payloads

| `type` | `payload` | Effect on the server |
|---|---|---|
| `ack_assignment` | `{ "assignmentId" }` | Assignment acknowledged |
| `picked_up` | `{ "checklist": { "itemsVerified": true, "bagCount": 2 } }` | Status `PICKED_UP` |
| `start_ride` | `{}` | Status `OUT_FOR_DELIVERY` |
| `arrived` | `{}` | Status `ARRIVED` |
| `deliver` / `deliver_offline` | `{ "otp", "otpCheckedLocally" }` | Status `DELIVERED`; **the server re-verifies the OTP** |
| `collect_cash` | `{ "amount" }` | Cash ledger entry ([F22](F22-rider-cash-and-settlement.md)) |
| `collect_upi_unverified` | `{ "amount", "note" }` | Records an unverified UPI payment (not cash in hand) |
| `failed_delivery` | `{ "reason", "note", "photoMediaId" }` | Status `FAILED_DELIVERY` |
| `location_batch` | `{ "points": [ … as in F20 … ] }` | Updates position history |

200 (one result per event, same order):
```json
{
  "data": {
    "results": [
      { "clientEventId": "c0a8…-01", "result": "applied" },
      { "clientEventId": "c0a8…-02", "result": "duplicate" },
      { "clientEventId": "c0a8…-03", "result": "conflict", "reason": "otp_mismatch", "message": "The OTP did not match. An admin will review this delivery." }
    ],
    "serverTime": "2026-11-05T11:20:00Z"
  }
}
```
- `applied`: done. `duplicate`: seen before; treat as success and delete it from the outbox. `conflict`: the event was **stored, not applied or only partly applied**; show the `message` to the rider and keep it visible. Never silently drop it.
- Conflict `reason` values: `otp_mismatch`, `order_cancelled`, `reassigned`, `already_delivered`, `invalid_transition`, `already_paid_online` (cash taken on an order the customer paid online: recorded as **overpaid** for refund review), `not_assigned_to_you`.
- Cash collected on a cancelled or reassigned order is recorded as **unmatched** for the admin, never discarded.
- The server also flags offline deliveries when the GPS is far from the address (more than `geofenceMeters`, flag only), the OTP differs, or the device time is far from the server time. Flagged orders appear in the admin review list.
- "Delivered" messages to the customer are sent **when the server receives and applies** the event, not before.

Retry rules: resend the whole batch after a network error (it is idempotent). Send again on app foreground, when connectivity returns, and about every 30 s while events remain. Back off exponentially up to a cap. A rider cannot end a shift while the outbox is not empty.

Errors (whole request): `400 VALIDATION_ERROR` · `401 UNAUTHORIZED` · `403 FORBIDDEN`.

## GET /admin/offline-reviews
Query: `warehouseId`, `status=open|resolved`, `from`, `to`. 200:
```json
{
  "data": [{
    "orderId": "ord_1", "orderNo": "DS-240001-A", "riderName": "Pema Sherpa",
    "deliveredAt": "2026-11-05T11:02:10Z", "syncedAt": "2026-11-05T11:20:00Z",
    "flags": ["otp_mismatch", "far_from_address"],
    "distanceFromAddressM": 640, "amountDue": 8800, "collection": { "method": "cash", "amount": 8800 }, "reviewStatus": "open"
  }],
  "meta": { "openCount": 1, "nextCursor": null }
}
```
`flags`: `otp_mismatch`, `far_from_address`, `time_skew`.

## POST /admin/offline-reviews/:orderId/resolve
Body: `{ "outcome": "accepted", "note": "Customer confirmed by phone" }`. `outcome`: `accepted` or `rejected` (a rejected delivery moves the order to `FAILED_DELIVERY` for the usual resolution, [F18](F18-dispatch-and-assignment.md)). 200: the review with `reviewStatus: "resolved"`. Audited.

## Customer app offline summary
- Open from the MMKV cache, then `GET /catalog/changes?zoneId=&since=<cursor>` in the background; `fullResync: true` means reload everything.
- Cart taps work offline; `PUT /cart` syncs when back online.
- Place order needs a network and a valid quote: disable the button offline. Retry the **same** `Idempotency-Key` after a timeout.
- Tracking: keep the last response and show "Updated N min ago" ([F20](F20-eta-and-live-tracking.md)).
