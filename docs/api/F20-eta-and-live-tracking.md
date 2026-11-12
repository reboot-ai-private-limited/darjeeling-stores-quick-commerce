# API · F20 ETA & Live Tracking

Spec: [F20](../delivery/20-eta-and-live-tracking.md) · Conventions: [00](00-conventions.md)

ETA is **pack time + rider-arrival time + travel time + extra minutes (rain, night)**. Before an order is on the road the ETA comes from the quote ([F10](F10-cart-and-quote.md)); once it is out for delivery it is recalculated from the rider's position about every 60 s. **No sockets:** the customer app polls.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/orders/:id/tracking` | Customer | Status, ETA and rider position for one child order |
| `GET` | `/track/:token` | Token link | Public tracking page data (no login) |
| `GET` | `/rider/orders/:id/route` | Rider | The road from the rider to the customer's door, for the map |
| `POST` | `/rider/location` | Rider | Send location pings |

The admin map uses `GET /admin/riders/live` ([F18](F18-dispatch-and-assignment.md)). The promised-vs-actual report is in [F25](F25-admin-panel-settings-and-reports.md).

## GET /orders/:id/tracking
Poll every ~10 s while the order is out for delivery and ~30 s before that. Stop on `DELIVERED` or `CANCELLED`, and when the screen or app goes to the background. 200:
```json
{
  "data": {
    "orderId": "ord_1",
    "orderNo": "DS-240001-A",
    "status": "OUT_FOR_DELIVERY",
    "eta": {
      "promisedAt": "2026-11-05T11:05:00Z",
      "liveEtaMinutes": 9,
      "liveEtaAt": "2026-11-05T11:03:30Z",
      "updatedAt": "2026-11-05T10:54:30Z"
    },
    "rider": {
      "name": "Pema Sherpa",
      "phone": "+919800000010",
      "location": { "lat": 27.0415, "lng": 88.2660 },
      "lastLocationAt": "2026-11-05T10:54:20Z"
    },
    "timeline": [
      { "status": "PLACED", "at": "2026-11-05T10:30:00Z" },
      { "status": "PICKED_UP", "at": "2026-11-05T10:44:00Z" },
      { "status": "OUT_FOR_DELIVERY", "at": "2026-11-05T10:44:10Z" }
    ],
    "group": {
      "groupNo": "DS-240001",
      "children": [
        { "id": "ord_1", "orderNo": "DS-240001-A", "status": "OUT_FOR_DELIVERY", "promisedAt": "2026-11-05T11:05:00Z" },
        { "id": "ord_2", "orderNo": "DS-240001-B", "status": "PACKING", "promisedAt": "2026-11-05T11:10:00Z" }
      ]
    },
    "deliveryOtp": "4271"
  }
}
```
What the app must do:
- Show **"Updated N min ago"** from `rider.lastLocationAt`, not a frozen marker. Animate the marker between points on the client.
- **`rider` is `null` until the order is picked up**, and `rider.location` is only present from `PICKED_UP` to `ARRIVED`. Before that, show the ETA only.
- `liveEtaMinutes` is `null` until the ride starts; use `eta.promisedAt` then.
- A rider carrying several orders is never shown with other customers' stops.
- Keep the last response when a poll fails and show it with its age.

Errors: `404 NOT_FOUND` (not your order).

## GET /track/:token
The WhatsApp message carries a link with an **expiring token** so the page works without login. 200 (no address, no phone, no other customers):
```json
{
  "data": {
    "orderNo": "DS-240001-A",
    "status": "OUT_FOR_DELIVERY",
    "eta": { "promisedAt": "2026-11-05T11:05:00Z", "liveEtaMinutes": 9, "updatedAt": "2026-11-05T10:54:30Z" },
    "rider": { "firstName": "Pema", "location": { "lat": 27.0415, "lng": 88.2660 }, "lastLocationAt": "2026-11-05T10:54:20Z" },
    "destination": { "location": { "lat": 27.0410, "lng": 88.2663 } },
    "expiresAt": "2026-11-06T10:30:00Z"
  }
}
```
Errors: `404 NOT_FOUND` (bad or revoked token) · `410` is not used: an expired token returns `404` so tokens cannot be probed.

## GET /rider/orders/:id/route
Query: `lat` and `lng` (where the rider is now). Only the rider the order is assigned to may ask; anyone else gets `404`. The road comes from Google Routes for a two-wheeler and is cached for 30 seconds per pair of places. 200:
```json
{ "data": { "distanceM": 2300, "durationS": 540, "approximate": false, "points": [{ "lat": 27.0405, "lng": 88.2663 }, { "lat": 27.0398, "lng": 88.2660 }], "destination": { "lat": 27.0360, "lng": 88.2627 } } }
```
When Google has no answer (no key, a timeout, no road) the server returns a straight line between the two points with `"approximate": true` and the estimated time, so the map is never empty.

## POST /rider/location
The rider app sends one point or a buffered batch. Interval: about every 10 s while it has an order, about every 60 s when idle but online (the server returns the interval to use). Body:
```json
{
  "points": [
    { "location": { "lat": 27.0415, "lng": 88.2660 }, "accuracyM": 12, "speedKmh": 18, "at": "2026-11-05T10:54:20Z" },
    { "location": { "lat": 27.0417, "lng": 88.2662 }, "accuracyM": 10, "speedKmh": 20, "at": "2026-11-05T10:54:30Z" }
  ]
}
```
Up to ~200 points per call (after a dead spot). 200:
```json
{ "data": { "accepted": 2, "nextPingSeconds": 10, "serverTime": "2026-11-05T10:54:32Z" } }
```
The server keeps the latest point as the rider's position and recalculates the live ETA at most once per ~60 s. Old buffered points never overwrite a newer position.

Errors: `403 FORBIDDEN` (not on shift) · `400 VALIDATION_ERROR`.

## Where else ETA appears
- Home header range: `eta.minMinutes`/`maxMinutes` in `GET /store/status` ([F08](F08-discovery-and-location.md)).
- Checkout: `allocation[].eta.promisedAt` in the quote ([F10](F10-cart-and-quote.md)); saved on the order as `promisedAt` ([F13](F13-order-placement-and-split-orders.md)).
- Split orders: each child has its own `promisedAt`; the group arrives when the latest does. For batches, stop N's ETA is stop N-1's ETA plus the leg between them.

## Implementation notes (backend, D2-10)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. A `:id` that is not a valid id on the customer route is `404`.
- **Positions.** Every point is kept for 30 days (a repeat of the same rider and time is skipped, so a resent batch is harmless). The newest point becomes the rider's position, but a point older than the position already held never replaces it. A time more than 5 minutes ahead of the server is treated as now; a point older than 7 days is dropped (and not counted in `accepted`). A ping from a rider who is not on shift is `403`. A ping also brings back a rider the server had marked offline for a silent phone.
- **`nextPingSeconds`** is 10 while the rider has an order and 60 otherwise (settings `locationPingSecondsOnOrder` and `locationPingSecondsIdle`).
- **Live ETA** is worked out on a ping, at most once a minute for each order the rider is out with (`OUT_FOR_DELIVERY`). Until a routes service is connected it is the straight-line distance times 1.3 at 18 km/h, at least 1 minute, plus `extraMinutes` for rain or night. A routes provider replaces it by passing `eta` to `createDev2Modules`. `liveEtaMinutes` is `null` before the ride and `0` once the rider has arrived. **Known shortcut:** a batch stop's ETA is worked out from the rider's position, not chained from the stop before it.
- **Customer tracking.** Only the customer who placed the order sees it (`404` for anyone else). `rider` is shown only from `PICKED_UP` to `ARRIVED`. `deliveryOtp` is shown while the order is open and needs a code. Nothing about the rider's other orders is returned.
- **Public link.** A signed link carries the order and its expiry (24 hours by default), so nothing is stored. `tracking.service.link(orderId)` makes it for Dev 1's WhatsApp message, and `tracking.service.revoke(orderId)` withdraws it. A link that is wrong, edited, expired or withdrawn is the same `404`. The secret comes from the `trackingTokenSecret` option (set it from an environment variable); without one no link can be made and every link is `404`.
- **For Dev 1.** `OrdersPort` gained `timeline` and `deliveryCode`, and the order gained `customerUserId` and `groupNo`; see `apps/api/src/platform/orders.ts`. Pass `customer` to `createDev2Modules` for the customer login.
