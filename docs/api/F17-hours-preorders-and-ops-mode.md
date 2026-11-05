# API · F17 Hours, Pre-orders & Ops Mode

Spec: [F17](../orders/17-hours-preorders-and-ops-mode.md) · Conventions: [00](00-conventions.md)

`GET /store/status` (open/closed, paused, pre-order availability, fee notices) is documented in [F08](F08-discovery-and-location.md). Placing a pre-order is a normal quote and order with a `scheduledWindow` ([F10](F10-cart-and-quote.md), [F13](F13-order-placement-and-split-orders.md)).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/preorder/slots` | Customer | Next-morning slots with remaining capacity |
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
