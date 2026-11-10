# API · F17 Hours, Pre-orders & Ops Mode

Spec: [F17](../orders/17-hours-preorders-and-ops-mode.md) · Conventions: [00](00-conventions.md)

`GET /store/status` (open/closed, paused, pre-order availability, fee notices) is documented in [F08](F08-discovery-and-location.md). Placing a pre-order is a normal quote and order with a `scheduledWindow` ([F10](F10-cart-and-quote.md), [F13](F13-order-placement-and-split-orders.md)).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/preorder/slots` | Customer | Next-morning slots with remaining capacity |
| `GET` | `/admin/warehouses/:id/hours` | Admin `warehouses:view` | Saved hours, pre-order slots and pause of a warehouse |
| `PUT` | `/admin/warehouses/:id/hours` | Admin `warehouses:manage` | Opening hours and after-hours mode |
| `PUT` | `/admin/warehouses/:id/preorder` | Admin `warehouses:manage` | Pre-order slots and cutoff |
| `POST` | `/admin/ops/pause` | Admin `ops_mode:manage` | Pause orders for a zone or warehouse 🔒 |
| `POST` | `/admin/ops/resume` | Admin `ops_mode:manage` | End a pause 🔒 |
| `POST` | `/admin/ops/rain` | Admin `ops_mode:manage` | Rain mode (see [F11](F11-delivery-fees-and-surcharges.md)) |
| `GET` | `/admin/preorders` | Admin `orders:view` | Pre-orders waiting for their slot |

## GET /preorder/slots
Query: `zoneId`. Only meaningful when the zone is closed and pre-order is on (otherwise `slots` is empty). 200:
```json
{
  "data": {
    "available": true,
    "slots": [
      { "start": "2026-11-06T07:00:00+05:30", "end": "2026-11-06T09:00:00+05:30", "label": "Tomorrow 7–9 AM", "remaining": 14, "cutoffAt": "2026-11-06T06:00:00+05:30" },
      { "start": "2026-11-06T09:00:00+05:30", "end": "2026-11-06T11:00:00+05:30", "label": "Tomorrow 9–11 AM", "remaining": 0, "cutoffAt": "2026-11-06T08:00:00+05:30" }
    ]
  }
}
```
`remaining: 0` = full (show disabled). Pass the chosen `start` and `end` as `scheduledWindow` when requesting a quote.

Errors when requesting a quote or order for a slot: `409 CONFLICT` with `details.reason: "slot_full"` or `"cutoff_passed"`.

## GET /admin/warehouses/:id/hours
200: the warehouse's saved settings, for the editor: `{ "data": { "warehouseId", "warehouse": { "id", "name", "zoneId" }, "configured": true, "hours": [...], "lastOrderMinutesBeforeClose": 15, "afterHoursMode": "closed", "preOrder": { "enabled", "slots", "cutoffMinutesBeforeSlot", "packLeadMinutes" }, "pause": null | { "active": true, "message", "until" } } }`. Before the first save `configured` is false and the values are the defaults from settings (`hours.*` and `preOrder.*`), with no opening hours, so the warehouse follows the geography module's own open flag. `403` for a warehouse outside the caller's scope.

## PUT /admin/warehouses/:id/hours
Body:
```json
{
  "hours": [{ "days": [0, 1, 2, 3, 4, 5, 6], "open": "07:00", "close": "20:00" }],
  "lastOrderMinutesBeforeClose": 15,
  "afterHoursMode": "pre_order"
}
```
`days`: 0 = Sunday … 6 = Saturday. Times are IST. `afterHoursMode`: `closed` or `pre_order`. For late-night delivery, set a later `close` and add a late-night fee rule ([F11](F11-delivery-fees-and-surcharges.md)). 200: the warehouse.

## PUT /admin/warehouses/:id/preorder
Body:
```json
{
  "enabled": true,
  "slots": [
    { "start": "07:00", "end": "09:00", "capacity": 20 },
    { "start": "09:00", "end": "11:00", "capacity": 20 }
  ],
  "cutoffMinutesBeforeSlot": 60,
  "packLeadMinutes": 45
}
```
200: the warehouse. Errors: `400 VALIDATION_ERROR` (overlapping slots).

## POST /admin/ops/pause
Body:
```json
{ "scope": "warehouse", "id": "wh_1", "message": "Road blocked at Chowrasta", "until": "2026-11-05T14:00:00Z" }
```
`scope`: `warehouse` or `zone`. `until` is optional (open-ended). 200: `{ "data": { "scope": "warehouse", "id": "wh_1", "pause": { "active": true, "message": "Road blocked at Chowrasta", "until": "2026-11-05T14:00:00Z" } } }`. While paused: browsing works, quotes return `409 ZONE_PAUSED`.

## POST /admin/ops/resume
Body: `{ "scope": "warehouse", "id": "wh_1" }` → 200: `{ "data": { "ok": true } }`.

## POST /admin/ops/rain
Switches rain mode (surcharge and extra minutes) on or off with an automatic end time. Body and response are described in [F11](F11-delivery-fees-and-surcharges.md#post-adminopsrain). Staff need `ops_mode:manage`, not full settings access.

## GET /admin/preorders
Query: `date=2026-11-06`, `warehouseId`, `slotStart`. 200:
```json
{
  "data": [{ "orderId": "ord_20", "orderNo": "DS-240020", "scheduledWindow": { "start": "2026-11-06T07:00:00+05:30", "end": "2026-11-06T09:00:00+05:30" }, "status": "CONFIRMED", "itemCount": 6, "packingStartsAt": "2026-11-06T06:15:00+05:30" }],
  "meta": { "count": 1, "bySlot": [{ "start": "07:00", "booked": 6, "capacity": 20 }] }
}
```
`packingStartsAt` = slot start minus `packLeadMinutes`: the packing list picks the order up from then.

## Pre-order rules the apps must show
- Pre-orders are priced at placement; delivery-time surcharges are **not** re-applied (tell the customer at checkout).
- Online payment is taken at order time. Cancel is allowed until the slot cutoff (`POST /orders/:id/cancel`).

## Implementation notes (backend, hours module)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. Hours and slots are stored by the hours module (collections `warehouse_hours`, `ops_pauses`), not on the geography warehouse, so they can be changed without touching F03.
- **Open or closed.** A warehouse takes orders on a day inside `open` to `close` minus `lastOrderMinutesBeforeClose`, in Indian time. A warehouse with no hours set follows the geography module's own open flag. A zone takes orders when any of its warehouses is open and not paused. Every module reads the geography port through this check, so `/store/status`, quotes and allocation agree.
- **Pauses** are per warehouse or zone, with a message and an optional end time that ends them on its own. They are checked together with a pause set in the geography module (F03). If every warehouse of a zone is paused, or the zone is, a quote answers `409 ZONE_PAUSED` with `details.message` and `details.until`; browsing is unaffected. A manager can pause a zone only if every warehouse of it is in their scope. Pause and resume are audited.
- **Closed.** `409 STORE_CLOSED` carries `opensAt` (next opening, null if no hours are set) and `preOrderAvailable`.
- **Slots.** `GET /preorder/slots` lists today's and tomorrow's configured slots whose booking cutoff has not passed (the earliest day that has any), with `remaining` (the most any warehouse has left). `available` is false when the zone is open, paused, or no warehouse offers pre-orders. A requested window must match a configured slot exactly (start time and length) on today or tomorrow. `label` reads "Today 7–9 AM" or "Tomorrow 9–11 AM". Pre-order settings can be saved before hours and are kept when hours change.
- **Placing.** A quote for a window is priced at once with the slot end as `promisedAt`; it uses only the warehouses that offer that slot and have room. At placement each child takes one place in the slot atomically, so capacity can never be passed: the loser gets `409 CONFLICT` (`details.reason: slot_full`) and nothing is taken. A passed cutoff is `409` / `cutoff_passed`. Cancelling an order gives its place back. A pre-order while the store is open is `400`.
- **Packing list.** `GET /admin/preorders` defaults to tomorrow (`date=YYYY-MM-DD`); `packingStartsAt` is the slot start minus `packLeadMinutes`; `bySlot` counts places booked and capacity for the date. Cancelled orders are left out. Nothing moves an order automatically at that time; the order stays `CONFIRMED` until packing starts.
- **Rain mode** is in the pricing module ([F11](F11-delivery-fees-and-surcharges.md)).
