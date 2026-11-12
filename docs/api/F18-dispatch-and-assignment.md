# API · F18 Dispatch, Assignment & Handover

Spec: [F18](../delivery/18-dispatch-and-assignment.md) · Conventions: [00](00-conventions.md)

The admin or store manager assigns orders; **riders cannot reject**. A rider acknowledges, or the system escalates after `ackTimeoutSeconds` (WhatsApp to the rider and an alert to the admin). The board is fed by `GET /admin/orders/changes` ([F14](F14-order-lifecycle-and-packing.md)). Rider-side calls are in [F19](F19-rider-app.md).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/dispatch/ready` | Admin `dispatch:manage` | Every ready order waiting for a rider, with its ranked riders |
| `GET` | `/admin/dispatch/suggestions` | Admin `dispatch:manage` | Ranked eligible riders for an order |
| `POST` | `/admin/orders/:id/assign` | Admin `dispatch:manage` | Assign an order to a rider 🔒 |
| `POST` | `/admin/orders/:id/unassign` | Admin `dispatch:manage` | Take it back (before pickup) 🔒 |
| `POST` | `/admin/order-groups/:id/dispatch` | Admin `dispatch:manage` | Dispatch a split order: same or different riders 🔒 |
| `POST` | `/admin/batches` | Admin `dispatch:manage` | Build a batch of stops for one rider |
| `GET` | `/admin/batches` | Admin `dispatch:manage` | List batches |
| `PUT` | `/admin/batches/:id` | Admin `dispatch:manage` | Reorder stops or add/remove orders |
| `POST` | `/admin/batches/:id/cancel` | Admin `dispatch:manage` | Cancel a batch that has not started |
| `POST` | `/admin/orders/:id/reassign` | Admin `dispatch:manage` | Give an assigned (not yet picked-up) order to another rider |
| `POST` | `/admin/orders/:id/handover` | Admin `dispatch:manage` | Hand a picked-up order to another rider 🔒 |
| `POST` | `/admin/orders/:id/failed/resolve` | Admin `orders:manage` | Resolve a failed delivery 🔒 |
| `GET` | `/admin/assignments` | Admin `dispatch:manage` | Assignments with acknowledgement status |
| `GET` | `/admin/dispatch/alerts` | Admin `dispatch:manage` | Unacknowledged, delayed, offline, rider-reported problems |
| `GET` | `/admin/riders/live` | Admin `dispatch:manage` | Rider positions and loads for the map |

## GET /admin/dispatch/ready
Every child order in `READY` that has no live assignment, inside the caller's warehouse scope, oldest first. Each row carries what an admin needs to assign it in one click. 200:
```json
{
  "data": [{
    "orderId": "ord_1", "orderNo": "DS-240004", "warehouseId": "wh_1", "locality": "Chowrasta", "landmark": "Opposite the clock tower", "customerName": "Asha Rai",
    "itemCount": 4, "paymentMethod": "cod", "alreadyPaid": false, "amountDue": 45000, "readyAt": "2026-11-11T10:06:03Z", "minutesWaiting": 3,
    "suggested": [{ "riderId": "rider_1", "name": "Pema Sherpa", "activeOrders": 0, "distanceMeters": 450, "score": 1 }],
    "ineligible": [{ "riderId": "rider_3", "name": "Karma Bhutia", "reasons": ["offline"] }]
  }]
}
```
`suggested` and `ineligible` follow the same rules as the suggestions call below.

## GET /admin/dispatch/suggestions
Query: `orderId` (a child order in `READY`, or one that already has a rider: then `currentRiderId` names them and they are left out of the list; after pickup the warehouse no longer matters). Eligible = active, in the order's zone, allowed at its warehouse, on shift, not on break, under `maxActiveOrders`, with a recent ping. 200:
```json
{
  "data": {
    "orderId": "ord_1",
    "suggested": [
      { "riderId": "rider_1", "name": "Pema Sherpa", "activeOrders": 0, "distanceMeters": 450, "lastAssignedAt": "2026-11-05T08:40:00Z", "score": 1 },
      { "riderId": "rider_2", "name": "Tashi Lepcha", "activeOrders": 1, "distanceMeters": 900, "lastAssignedAt": "2026-11-05T09:10:00Z", "score": 2 }
    ],
    "ineligible": [{ "riderId": "rider_3", "name": "Karma Bhutia", "reasons": ["on_break"] }]
  }
}
```
Ranking: fewest active orders → nearest to the warehouse → least recently assigned. `reasons`: `offline`, `on_break`, `wrong_zone`, `wrong_warehouse`, `at_capacity`, `stale_location`.

## POST /admin/orders/:id/assign
Body: `{ "riderId": "rider_1", "batchId": null }`. 200:
```json
{
  "data": {
    "assignment": { "id": "asg_1", "orderId": "ord_1", "riderId": "rider_1", "status": "assigned", "mode": "manual", "ackDeadlineAt": "2026-11-05T10:41:00Z", "assignedAt": "2026-11-05T10:39:00Z" },
    "order": { "id": "ord_1", "status": "ASSIGNED" }
  }
}
```
The rider app gets a full-screen alarm push. Order → `ASSIGNED`.

Errors: `409 RIDER_NOT_ELIGIBLE` (`details.reasons[]`) · `409 INVALID_TRANSITION` (order not `READY`, or already assigned: unassign first) · `404 NOT_FOUND`.

## POST /admin/orders/:id/unassign
Body: `{ "reason": "Rider unreachable" }`. Order goes back to `READY`; any live acknowledgement timer is cancelled and the rider's list is updated. Errors: `409 INVALID_TRANSITION` (after pickup: use handover).

## POST /admin/order-groups/:id/dispatch
For a split group, the admin chooses one rider for both children (one batch with a pickup at each warehouse, one drop) or a different rider per child.

Same rider:
```json
{ "mode": "same_rider", "riderId": "rider_1", "pickupOrder": ["wh_1", "wh_2"] }
```
Different riders:
```json
{ "mode": "different_riders", "assignments": [{ "orderId": "ord_1", "riderId": "rider_1" }, { "orderId": "ord_2", "riderId": "rider_2" }] }
```
200: `{ "data": { "batch": <batch or null>, "assignments": [<assignment>] } }`. Errors: `409 RIDER_NOT_ELIGIBLE` (for same rider: not allowed at both warehouses, or over the batch limit; `details.reasons[]`) · `409 INVALID_TRANSITION` (a child is not `READY`).

One group OTP completes the delivery for the same-rider case; separate riders each verify the same group OTP.

## Batches
```json
{
  "id": "batch_1",
  "riderId": "rider_1",
  "zoneId": "zone_1",
  "status": "planned",
  "stops": [
    { "seq": 1, "type": "pickup", "warehouseId": "wh_1", "orderIds": ["ord_1"], "status": "pending" },
    { "seq": 2, "type": "pickup", "warehouseId": "wh_2", "orderIds": ["ord_2"], "status": "pending" },
    { "seq": 3, "type": "drop", "orderIds": ["ord_1", "ord_2"], "status": "pending" }
  ],
  "createdBy": "user_9"
}
```
`status`: `planned`, `active`, `done`, `cancelled`. `stops[].status`: `pending`, `arrived`, `done`. A batch holds up to `maxActiveOrders` orders (default 2, max 3) and may include pickups from several warehouses of the zone.

- `POST /admin/batches` body `{ "riderId": "rider_1", "orderIds": ["ord_1", "ord_2"], "stops": [ … optional explicit order … ] }` → 201 batch. All orders must be `READY` and in the rider's zone. Errors: `409 RIDER_NOT_ELIGIBLE` · `400 VALIDATION_ERROR` (over the batch limit).
- `GET /admin/batches?status=&riderId=` → `{ "data": [<batch>] }`.
- `PUT /admin/batches/:id` body `{ "stops": [ … reordered … ] }` or `{ "addOrderIds": [], "removeOrderIds": [] }`; only while `planned`.
- `POST /admin/batches/:id/cancel` → 200 `{ "data": { "ok": true } }`.

## POST /admin/orders/:id/reassign
Before pickup (`ASSIGNED`). Body: `{ "toRiderId": "rider_2", "reason": "Closer to the customer" }` (`reason` is optional). The first rider's alarm is cancelled and the new rider's rings; the order stays `ASSIGNED`. 200 has the same shape as the handover below. Errors: `409` (the order is not assigned, or already picked up: use a hand-over), `400` (the same rider), `409` with the reasons from the suggestions call when the new rider cannot take it.

## POST /admin/orders/:id/handover
For a breakdown or road block **after pickup**. Body: `{ "toRiderId": "rider_2", "reason": "Scooter breakdown at Hill Cart Road" }`. 200:
```json
{ "data": { "assignment": { "id": "asg_5", "orderId": "ord_1", "riderId": "rider_2", "status": "assigned", "ackDeadlineAt": "…" }, "order": { "id": "ord_1", "status": "OUT_FOR_DELIVERY" } } }
```
The order status does not change; the new rider acknowledges and then confirms physical hand-over in the app (F19). If goods cannot be handed over, the first rider returns to the warehouse and the admin unassigns the order (it goes back to `READY`). Errors: `409 RIDER_NOT_ELIGIBLE`.

## POST /admin/orders/:id/failed/resolve
For an order in `FAILED_DELIVERY`. Body:
```json
{ "action": "redispatch", "note": "Customer will be home at 6 PM" }
```
```json
{ "action": "cancel_return", "goodsCondition": "good", "note": "Customer refused" }
```
`action`: `redispatch` (→ `READY`) or `cancel_return` (→ `CANCELLED`). `goodsCondition`: `good` (stock restored, reason `return`) or `spoiled` (written off, reason `wastage`). Prepaid orders get a refund; COD has nothing to refund. 200: `{ "data": { "order": { "id": "ord_1", "status": "READY" }, "refund": null } }`. Repeated failures can lead to COD being disabled for the customer ([F25](F25-admin-panel-settings-and-reports.md)).

## GET /admin/assignments
Query: `status`, `riderId`, `warehouseId`. 200:
```json
{ "data": [{ "id": "asg_1", "orderNo": "DS-240001-A", "riderId": "rider_1", "riderName": "Pema Sherpa", "status": "assigned", "ackDeadlineAt": "2026-11-05T10:41:00Z", "overdue": false }], "meta": { "count": 1 } }
```
`status`: `assigned`, `acknowledged`, `reassigned`, `cancelled`, `completed` (no `rejected`).

## GET /admin/dispatch/alerts
200:
```json
{
  "data": [
    { "type": "ack_overdue", "orderId": "ord_1", "riderId": "rider_1", "since": "2026-11-05T10:41:00Z", "message": "Pema has not acknowledged for 2 min (WhatsApp sent)" },
    { "type": "rider_problem", "orderId": "ord_3", "riderId": "rider_2", "problem": "vehicle_issue", "note": "Puncture" },
    { "type": "order_delayed", "orderId": "ord_4", "state": "READY", "minutes": 9 },
    { "type": "rider_offline", "riderId": "rider_3", "hasActiveOrder": true }
  ]
}
```
`type`: `ack_overdue`, `rider_problem`, `order_delayed`, `rider_offline`, `failed_delivery`, `offline_delivery_flagged`.

## GET /admin/riders/live
Query: `zoneId`, `warehouseId`. Poll about every 10 s for the map. 200:
```json
{
  "data": [{
    "riderId": "rider_1", "name": "Pema Sherpa", "status": "online", "currentWarehouseId": "wh_1",
    "location": { "lat": 27.0415, "lng": 88.2660 }, "lastLocationAt": "2026-11-05T10:44:20Z",
    "activeOrders": [{ "orderId": "ord_1", "orderNo": "DS-240001-A", "status": "OUT_FOR_DELIVERY" }]
  }]
}
```

## Implementation notes (backend, D2-7)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422, as everywhere else in this API. New error codes: `RIDER_NOT_ELIGIBLE` 409 (`details.reasons`: `offline`, `on_break`, `wrong_zone`, `wrong_warehouse`, `at_capacity`, `stale_location`), `INVALID_TRANSITION` 409 (`details.from`/`to`, or `reason`: `after_pickup`, `before_pickup`, `pickups_pending`), `ALREADY_ACKNOWLEDGED` 409, `OTP_MISMATCH` 401, `OTP_LOCKED` 429.
- **Ranking.** Suggestions are ordered by fewest active orders, then nearest to the warehouse, then longest since the last assignment; `score` is the position (1 = best). Riders who cannot take the order come back under `ineligible` with their reasons, and a rider's position must be under 5 minutes old.
- **One live assignment per order** is enforced by a unique partial index, and a rider's capacity (default 2 active orders) is claimed with one conditional update before the assignment is written, so two admins assigning at once cannot overload a rider or double-assign an order. On any failure the claim is given back.
- **Acknowledgement clock.** A new assignment is due in 120 s. After that a background sweep (every 10 s) sends one WhatsApp (`assignment_unacknowledged_v1`, to be approved in the Meta console) and the board shows `ack_overdue` with "(WhatsApp sent)". Picking the order up counts as acknowledging it. Taking the order back, or handing it over, cancels the wait.
- **Splitting.** `same_rider` builds one batch (a pickup per warehouse in `pickupOrder` or first-seen order, then one drop) and assigns every child; if any child fails, the others are undone and the batch is cancelled. `different_riders` assigns each child on its own, undoing the earlier ones if a later one fails.
- **Batches** hold at most `min(maxBatchOrders 3, rider limit 2)` orders. Only a `planned` batch can be edited; an assigned order must be unassigned before it is removed. Stops given by the caller must pick up and drop every order exactly once.
- **Hand-over** works only after pickup, ignores the new rider's warehouse list (the goods have left the warehouse) but still needs them online, in the zone, with room. The order's status does not change; the new rider must acknowledge, and the old assignment ends as `reassigned`.
- **Failed deliveries** stay on the board (`failed_delivery`) until resolved. `cancel_return` needs `goodsCondition` (`good` or `spoiled`) and returns the refund when the order was already paid.
- **Alerts** are worked out on request (no table): `ack_overdue`, `rider_problem`, `order_delayed` (ready more than 5 minutes with no assignment), `rider_offline` (offline with a shift or orders), `failed_delivery`. `offline_delivery_flagged` waits for offline sync (F21).
- **For Dev 1.** Implement `OrdersPort` (`apps/api/src/platform/orders.ts`) and `RiderIdentity` (`platform/identity.ts`), give `Geography` the new `warehouse(id)` (name and location), and call `dispatch.hooks.onOrderCancelled(orderId)` and `onOrderPaid(orderId)` from the order and payment flows. The order module must make dispatch's transitions through `OrdersPort.transition`, which applies the F14 rules.
- **Auto mode.** `assignmentMode: "auto"` (setting) lets a 15 s background job give ready orders to the best rider; the default is manual.
- **Not built here.** Physical hand-over confirmation by the receiving rider. Live tracking is [F20](F20-eta-and-live-tracking.md).
