# API · F19 Rider App

Spec: [F19](../delivery/19-rider-app.md) · Conventions: [00](00-conventions.md)

All `/rider/*` endpoints need a **rider** token and only return the rider's own data. Login is `POST /auth/request-otp` with `"app": "rider"` ([F01](F01-authentication.md)). The admin side of rider management is at the end of this file. Cash is [F22](F22-rider-cash-and-settlement.md), offline sync is [F21](F21-offline-and-low-network.md), location pings are [F20](F20-eta-and-live-tracking.md).

## Endpoints (rider)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/rider/me` | Rider | Profile, status, current shift and warehouse |
| `POST` | `/rider/shift/start` | Rider | Punch in and go online |
| `POST` | `/rider/shift/switch-warehouse` | Rider | Change current warehouse mid-shift |
| `POST` | `/rider/shift/break` | Rider | Go on break |
| `POST` | `/rider/shift/resume` | Rider | Come back from break |
| `POST` | `/rider/shift/end` | Rider | Punch out |
| `GET` | `/rider/assignments` | Rider | My assignments (poll with `since`) |
| `POST` | `/rider/assignments/:id/ack` | Rider | Acknowledge an assignment |
| `GET` | `/rider/orders/:id` | Rider | Order detail for delivery |
| `POST` | `/rider/orders/:id/pickup` | Rider | Picked up at the warehouse |
| `POST` | `/rider/orders/:id/start-ride` | Rider | Start the ride |
| `POST` | `/rider/orders/:id/arrived` | Rider | Arrived at the door |
| `POST` | `/rider/orders/:id/verify-otp` | Rider | Check the customer's delivery OTP |
| `POST` | `/rider/orders/:id/deliver` | Rider | Mark delivered |
| `POST` | `/rider/orders/:id/failed` | Rider | Report a failed delivery |
| `POST` | `/rider/orders/:id/problem` | Rider | Report a problem to the admin |
| `GET` | `/rider/history` | Rider | My delivery history |
| `PUT` | `/rider/profile/photo` | Rider | Set my profile photo |

Also used by the rider app: `GET /rider/orders/:id/bundle`, `POST /rider/sync` (F21), `POST /rider/location` (F20), `GET /rider/cash`, `POST /rider/orders/:id/collect-cash`, `POST /rider/orders/:id/collect-upi` (F22), `POST /devices` and `GET /app/config` (F01).

## GET /rider/me
200:
```json
{
  "data": {
    "riderId": "rider_1", "name": "Pema Sherpa", "phone": "+919800000010",
    "photo": { "mediaId": "media_50" },
    "zoneId": "zone_1",
    "warehouses": [{ "id": "wh_1", "name": "Chowrasta store", "location": { "lat": 27.0410, "lng": 88.2663 } }, { "id": "wh_2", "name": "Mall Road store", "location": { "lat": 27.0432, "lng": 88.2641 } }],
    "status": "online",
    "currentWarehouseId": "wh_1",
    "currentShift": { "id": "shift_1", "startedAt": "2026-11-05T02:30:00Z", "warehouseId": "wh_1" },
    "activeOrderCount": 1,
    "pendingSyncCount": 0,
    "settings": { "locationPingSecondsOnOrder": 10, "locationPingSecondsIdle": 60, "ackTimeoutSeconds": 120, "deliveryOtpEnabled": true, "maxActiveOrders": 2 }
  }
}
```
`status`: `offline`, `online`, `on_break`. Apps read ping intervals from `settings` so they can be tuned without a new release.

## POST /rider/shift/start
Body: `{ "warehouseId": "wh_1", "location": { "lat": 27.0411, "lng": 88.2664 }, "accuracyM": 12 }`. Punch-in must be within `punchInRadiusMeters` of the warehouse; outside is **allowed but flagged** for the admin. 200:
```json
{ "data": { "shiftId": "shift_1", "status": "online", "punchIn": { "distanceFromWarehouseM": 22, "verified": true }, "currentWarehouseId": "wh_1" } }
```
Errors: `403 FORBIDDEN` (deactivated) · `409 CONFLICT` (a shift is already open) · `403 FORBIDDEN` with `details.reason: "warehouse_not_allowed"` (not one of the rider's warehouses).

## POST /rider/shift/switch-warehouse
Body: `{ "warehouseId": "wh_2" }` → 200 `{ "data": { "currentWarehouseId": "wh_2" } }`. Errors: `403 FORBIDDEN` (not allowed there).

## POST /rider/shift/break · resume · end
No body. `break`: not offered new orders. `end` → 200 `{ "data": { "shiftId": "shift_1", "hoursWorked": 8.4 } }`. Errors for `end`: `409 CONFLICT` with `details.reason: "active_orders"` or `"unsynced_events"` (the app must finish deliveries and sync first; an admin can override).

## GET /rider/assignments
Poll about every 15 s in the foreground (a push wakes the app when it is closed). Query: `since` (omit the first time). 200:
```json
{
  "data": [
    {
      "event": "assigned",
      "assignment": {
        "id": "asg_1", "status": "assigned", "assignedAt": "2026-11-05T10:39:00Z", "ackDeadlineAt": "2026-11-05T10:41:00Z",
        "batch": { "id": "batch_1", "stops": [
          { "seq": 1, "type": "pickup", "warehouseId": "wh_1", "orderIds": ["ord_1"], "status": "pending" },
          { "seq": 2, "type": "drop", "orderIds": ["ord_1"], "status": "pending" }
        ] },
        "orders": [{
          "id": "ord_1", "orderNo": "DS-240001-A", "groupId": "grp_1", "status": "ASSIGNED",
          "warehouse": { "id": "wh_1", "name": "Chowrasta store", "location": { "lat": 27.0410, "lng": 88.2663 } },
          "customerName": "Asha Rai", "locality": "Chowrasta", "itemCount": 2,
          "amountDue": 8800, "paymentStatus": "cod_pending", "promisedAt": "2026-11-05T11:05:00Z"
        }]
      }
    }
  ],
  "meta": { "cursor": "c_77" }
}
```
`event`: `assigned`, `reassigned_away` (an order was taken from you), `cancelled`, `payment_paid` (**show "Already paid – do not collect"**), `updated`. Send `meta.cursor` as `since` next time.

## POST /rider/assignments/:id/ack
No body. 200: `{ "data": { "id": "asg_1", "status": "acknowledged", "ackAt": "2026-11-05T10:39:40Z" } }`. There is **no reject endpoint**. Errors: `409 ALREADY_ACKNOWLEDGED` · `404 NOT_FOUND` (not yours, or reassigned).

## GET /rider/orders/:id
200 (rider view; another rider's order is `404`):
```json
{
  "data": {
    "id": "ord_1", "orderNo": "DS-240001-A", "groupId": "grp_1", "status": "OUT_FOR_DELIVERY",
    "warehouse": { "id": "wh_1", "name": "Chowrasta store", "location": { "lat": 27.0410, "lng": 88.2663 } },
    "items": [{ "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "qty": 2, "status": "ok" }],
    "bagCount": null,
    "customer": { "name": "Asha Rai", "phone": "+919876543210" },
    "address": { "line1": "Cedar Villa, 2nd floor", "landmark": "Opposite Planters Club gate", "locality": "Chowrasta", "location": { "lat": 27.0410, "lng": 88.2663 }, "locationAccuracyM": 18, "deliveryNotes": "Ring the bell twice" },
    "voiceNote": { "mediaId": "media_60", "durationSec": 8, "expired": false },
    "housePhoto": { "mediaId": "media_61" },
    "paymentMethod": "cod", "paymentStatus": "cod_pending", "amountDue": 8800,
    "alreadyPaid": false,
    "otpRequired": true,
    "promisedAt": "2026-11-05T11:05:00Z",
    "batchStop": { "seq": 2, "of": 2 }
  }
}
```
The plain delivery OTP is **never** returned to riders. Fetch the voice note and photo through `GET /media/:id/url` ([F24](F24-media-storage.md)). Customer phone is for the call button.

## POST /rider/orders/:id/pickup
Body:
```json
{ "checklist": { "itemsVerified": true, "bagCount": 2 } }
```
200: the order with status `PICKED_UP`. Errors: `409 INVALID_TRANSITION` · `400 VALIDATION_ERROR` (`itemsVerified` must be true). After this call download the offline bundle (`GET /rider/orders/:id/bundle`, F21).

## POST /rider/orders/:id/start-ride
No body. For a batch, call it after all pickups are done. For a single stop the app calls `pickup` and `start-ride` back to back (both transitions are recorded). 200: the order with status `OUT_FOR_DELIVERY`; the customer is notified with the tracking link. Errors: `409 INVALID_TRANSITION` (`details.reason: "pickups_pending"`).

## POST /rider/orders/:id/arrived
Body (optional): `{ "location": { "lat": 27.0410, "lng": 88.2663 } }`. 200: status `ARRIVED`; the customer is notified.

## POST /rider/orders/:id/verify-otp
Body: `{ "otp": "4271" }`. A pre-check that does not change state. 200: `{ "data": { "valid": true } }`. Errors: `401 OTP_MISMATCH` (`details.attemptsLeft`) · `429 OTP_LOCKED`.

## POST /rider/orders/:id/deliver
Body:
```json
{ "otp": "4271", "deliveredAt": "2026-11-05T11:02:10Z", "location": { "lat": 27.0410, "lng": 88.2663 }, "accuracyM": 14 }
```
200: `{ "data": { "id": "ord_1", "status": "DELIVERED", "deliveredAt": "2026-11-05T11:02:10Z", "groupStatus": "ACTIVE" } }`. For same-rider batches, the group OTP completes every child that this rider carries to that address.

For COD the payment must be recorded first (`collect-cash` or `collect-upi`, F22), otherwise `409 CONFLICT` with `details.reason: "collection_required"`. When there is no signal use the offline path instead (F21).

Errors: `401 OTP_MISMATCH` · `429 OTP_LOCKED` · `409 INVALID_TRANSITION` (not `ARRIVED`) · `409 CONFLICT` (already delivered; safe to ignore).

## POST /rider/orders/:id/failed
Body:
```json
{ "reason": "road_blocked", "note": "Landslide at Tiger Hill road", "photoMediaId": "media_70" }
```
`reason`: `customer_unreachable`, `wrong_address`, `refused`, `road_blocked`, `weather`, `other`. 200: the order with status `FAILED_DELIVERY`; the admin is alerted ([F18](F18-dispatch-and-assignment.md)).

## POST /rider/orders/:id/problem
Does **not** unassign the order; it alerts the admin, who decides. Body: `{ "type": "vehicle_issue", "note": "Puncture near Chowrasta" }`. `type`: `vehicle_issue`, `road_blocked`, `customer_issue`, `other`. 200: `{ "data": { "ok": true } }`.

## GET /rider/history
Query: `from`, `to`, `limit`, `cursor`. 200: `{ "data": [{ "orderId": "ord_1", "orderNo": "DS-240001-A", "status": "DELIVERED", "deliveredAt": "…", "amountDue": 8800, "collectionMethod": "cash", "deliveredOffline": false }], "meta": { "nextCursor": null, "deliveredToday": 7 } }`.

## PUT /rider/profile/photo
Body: `{ "mediaId": "media_50" }` (upload with F24 first). 200: `{ "data": { "ok": true } }`.

---

## Admin: rider management

These endpoints are needed by the admin panel but were not spelled out in the F19 flow; they implement the `riders:view` / `riders:manage` permissions.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/riders` | Admin `riders:view` | List riders |
| `POST` | `/admin/riders` | Admin `riders:manage` | Pre-register a rider 🔒 |
| `GET` | `/admin/riders/:id` | Admin `riders:view` | One rider |
| `PUT` | `/admin/riders/:id` | Admin `riders:manage` | Edit name, zone, allowed warehouses 🔒 |
| `POST` | `/admin/riders/:id/deactivate` | Admin `riders:manage` | Deactivate and revoke sessions 🔒 |
| `POST` | `/admin/riders/:id/reactivate` | Admin `riders:manage` | Reactivate 🔒 |
| `POST` | `/admin/riders/:id/force-offline` | Admin `riders:manage` | End the rider's shift 🔒 |
| `GET` | `/admin/riders/:id/shifts` | Admin `riders:view` | A rider's shifts |
| `GET` | `/admin/shifts` | Admin `riders:view` | Attendance across riders |
| `GET` | `/rider/tips` | Rider | My tips: totals and the deliveries behind them |

The live map is `GET /admin/riders/live` ([F18](F18-dispatch-and-assignment.md)).

### Object: admin rider
```json
{
  "id": "rider_1", "userId": "user_20", "name": "Pema Sherpa", "phone": "+919800000010",
  "zoneId": "zone_1", "warehouseIds": ["wh_1", "wh_2"], "currentWarehouseId": "wh_1",
  "vehicle": "Scooter", "status": "online", "activeOrderCount": 1,
  "lastLocation": { "lat": 27.0415, "lng": 88.2660 }, "lastLocationAt": "2026-11-05T10:44:20Z",
  "appVersion": "1.4.2", "pendingSyncCount": 0, "isActive": true
}
```

### POST /admin/riders
Body: `{ "name": "Pema Sherpa", "phone": "+919800000010", "zoneId": "zone_1", "warehouseIds": ["wh_1", "wh_2"], "vehicle": "Scooter" }`. Creates the user (role `rider`) and the rider profile so the phone can log in with `app: "rider"`. 201: the rider.

Errors: `409 CONFLICT` (phone already used) · `400 VALIDATION_ERROR` with `details.reason: "warehouse_outside_zone"` (**every allowed warehouse must be in the rider's zone**) · `404 NOT_FOUND`.

### PUT /admin/riders/:id
Body (all optional): `name`, `zoneId`, `warehouseIds`, `vehicle`, `photoMediaId`. Same cross-zone check. A rider on shift cannot change zone (`409 CONFLICT`).

### Deactivate / reactivate / force-offline
No body. 200: the rider. Deactivate revokes every token; a deactivated rider cannot start a shift or log in. Force-offline ends the open shift (`endedBy: "admin"`) and is blocked while the rider has an order in `PICKED_UP` or later unless `{ "force": true }`.

### GET /admin/riders · /admin/shifts
Riders query: `zoneId`, `warehouseId`, `status`, `q`. Shifts query: `riderId`, `warehouseId`, `from`, `to`. Shift item:
```json
{ "id": "shift_1", "riderId": "rider_1", "warehouseId": "wh_1", "startedAt": "2026-11-05T02:30:00Z", "endedAt": null, "punchIn": { "distanceFromWarehouseM": 22, "verified": true }, "breaks": [], "endedBy": null }
```
`punchIn.verified: false` = outside the radius (flagged).

## Implementation notes (backend, D2-7)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. A `:id` that is not a valid id is `404`.
- **Rider login is Dev 1's.** Every `/rider/*` route resolves the signed-in rider through the `rider` option of `createDev2Modules`; without it they answer 401. A deactivated rider is refused with 403.
- **Shifts.** Punching in is allowed anywhere but flagged (`verified: false`) when further than 150 m from the warehouse. One open shift per rider (claimed atomically). Ending a shift with orders already picked up is `409` (`reason: picked_up_orders`); an admin can force it. Hours worked exclude breaks. A rider whose phone stops sending a position for 10 minutes is moved offline by a 60 s sweep (`autoOffline`) and comes back by punching in again.
- **Work feed.** `GET /rider/assignments` with no `since` returns every live assignment and a cursor `c_<n>`; with `since=c_<n>` it returns only newer events (`assigned`, `reassigned_away`, `cancelled`, `payment_paid`) and the next cursor. Sequence numbers are allocated in the same transaction as the event, so no event is skipped.
- **Steps.** Pickup → start-ride → arrived → deliver, each one a rider-made order transition. `start-ride` in a batch waits for every pickup (`pickups_pending`). `arrived` also arrives the orders of the same checkout dropped at the same door. `deliver` needs the cash recorded first on pay-on-delivery orders (`409`, `reason: collection_required`), the delivery code when the order requires one (5 wrong tries locks it: `OTP_LOCKED`), and `deliveredAt` (for offline delivery) within the last day and not in the future. One code delivers every sibling at that door whose cash is recorded. Repeating a delivery answers `409` with `reason: already_delivered`.
- **Order view** never includes the delivery code. A rider sees their own live orders and ones they delivered or failed; anything else is `404`.
- **History** pages with `cursor`; `deliveredToday` counts from midnight India time.
- **Profile photo** is a `rider_photo` media upload; failed-delivery photos are `failed_delivery_photo` uploads claimed against the order.
- **Elsewhere.** Location pings are in [F20](F20-eta-and-live-tracking.md), the order bundle and offline sync in [F21](F21-offline-and-low-network.md), and cash in [F22](F22-rider-cash-and-settlement.md). The rider app screens are not built here.

## GET /rider/tips
Query: `from`, `to` (Indian days, default the last 7 days), `limit` (default 50, up to 200). 200: `{ "data": { "from": "2026-11-01", "to": "2026-11-07", "totals": { "count": 4, "total": 7000, "owed": 3000, "paid": 4000 }, "items": [{ "orderId": "...", "orderNo": "DS-1042", "amount": 2000, "deliveredAt": "2026-11-07T10:30:00.000Z", "status": "owed", "paidAt": null }] } }`. Amounts are paise. `owed` is what the owner has not yet paid out. See [F22](F22-rider-cash-and-settlement.md).
