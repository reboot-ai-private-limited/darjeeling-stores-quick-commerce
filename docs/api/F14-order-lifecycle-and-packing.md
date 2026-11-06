# API · F14 Order Lifecycle & Packing

Spec: [F14](../orders/14-order-lifecycle-and-packing.md) · Conventions: [00](00-conventions.md)

Admin side of orders: board, confirm, pack, mark items unavailable, cancel, print. Every status change goes through one server function and writes an order event, so an illegal change returns `409 INVALID_TRANSITION`. Dispatch is in [F18](F18-dispatch-and-assignment.md); rider-side status calls are in [F19](F19-rider-app.md).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/orders` | Admin `orders:view` | List and search orders |
| `GET` | `/admin/orders/changes` | Admin `orders:view` | Poll for new and changed orders (board, bell) |
| `GET` | `/admin/orders/:id` | Admin `orders:view` | Full order detail |
| `GET` | `/admin/order-groups/:id` | Admin `orders:view` | A group with all its children |
| `POST` | `/admin/orders/:id/confirm` | Admin `orders:manage` | Confirm (when auto-confirm is off) |
| `POST` | `/admin/orders/:id/start-packing` | Admin `orders:manage` | Start packing |
| `POST` | `/admin/orders/:id/items/:itemIndex/unavailable` | Admin `orders:manage` | Mark a line unavailable or reduce it 🔒 |
| `PUT` | `/admin/orders/:id/items/:itemIndex` | Admin `orders:manage` | Change a line's quantity before dispatch 🔒 |
| `POST` | `/admin/orders/:id/complete-packing` | Admin `orders:manage` | Packing done → READY |
| `POST` | `/admin/orders/:id/cancel` | Admin `orders:manage` | Cancel before pickup 🔒 |
| `POST` | `/admin/orders/:id/force-status` | Admin `orders:manage` | Force a status with a reason 🔒 |
| `POST` | `/admin/orders/:id/notes` | Admin `orders:manage` | Add an internal note |
| `GET` | `/admin/orders/:id/print` | Admin `orders:view` | Printable bill or packing slip |

Scoped staff only see orders of their warehouses.

## Object: admin order

```json
{
  "id": "ord_1",
  "orderNo": "DS-240001-A",
  "groupId": "grp_1",
  "warehouse": { "id": "wh_1", "name": "Chowrasta store" },
  "status": "PACKING",
  "paymentMethod": "cod",
  "paymentStatus": "cod_pending",
  "refundStatus": "none",
  "customer": { "id": "user_1", "name": "Asha Rai", "phone": "+919876543210" },
  "address": { "line1": "Cedar Villa, 2nd floor", "landmark": "Opposite Planters Club gate", "locality": "Chowrasta", "contactName": "Asha Rai", "contactPhone": "+919876543210", "location": { "lat": 27.0410, "lng": 88.2663 }, "deliveryNotes": "Ring the bell twice" },
  "items": [
    { "index": 0, "productId": "prod_1", "variantId": "var_2", "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "weightGrams": 500, "unitPrice": 3200, "qty": 2, "lineTotal": 6400, "gstRate": 0, "status": "ok" }
  ],
  "itemsSubtotal": 6400,
  "allocatedDiscount": 0,
  "allocatedCharges": [{ "type": "delivery_fee", "amount": 2400 }],
  "amountDue": 8800,
  "rider": null,
  "promisedAt": "2026-11-05T11:05:00Z",
  "scheduledWindow": null,
  "isPreOrder": false,
  "notes": [{ "text": "Customer wants ripe tomatoes", "by": "Dorjee Lama", "at": "2026-11-05T10:31:00Z" }],
  "timeline": [{ "type": "status_change", "from": "CONFIRMED", "to": "PACKING", "actor": { "role": "admin", "name": "Dorjee Lama" }, "at": "2026-11-05T10:33:00Z" }],
  "delivery": null,
  "collection": null,
  "createdAt": "2026-11-05T10:30:00Z"
}
```

## GET /admin/orders
Query: `warehouseId`, `status` (comma list), `paymentStatus`, `riderId`, `q` (order no, phone, name), `from`, `to`, `isPreOrder=true`, `flagged=true` (offline-delivery or reconciliation flags), `limit`, `cursor`. 200: `{ "data": [<admin order>], "meta": { "nextCursor": "c_2" } }`.

## GET /admin/orders/changes
The admin board polls this every ~5 s. Query: `since` (cursor; omit the first time), `warehouseId` (optional), `statuses` (optional). 200:
```json
{
  "data": [
    {
      "event": "created",
      "order": { "id": "ord_5", "orderNo": "DS-240005", "groupId": "grp_5", "warehouseId": "wh_1", "status": "PLACED", "itemCount": 3, "amountDue": 15000, "paymentMethod": "cod", "customerName": "Asha Rai", "locality": "Chowrasta", "riderId": null, "riderName": null, "ackStatus": null, "promisedAt": "2026-11-05T11:05:00Z", "delayed": false, "updatedAt": "2026-11-05T10:30:00Z" }
    }
  ],
  "meta": { "cursor": "c_9812", "newCount": 1 }
}
```
- `event`: `created` (ring the bell), `status_changed`, `assigned`, `ack_changed`, `updated`.
- Send `meta.cursor` back as `since`. If the call fails, keep the last data and retry; after a long gap refetch with `GET /admin/orders`.
- `ackStatus`: `null`, `waiting`, `acknowledged`, `overdue`.

## GET /admin/orders/:id · GET /admin/order-groups/:id
200: the admin order, or the group with `children[]` (each in the admin shape). `403 FORBIDDEN` outside the caller's warehouse scope.

## POST /admin/orders/:id/confirm · start-packing · complete-packing
No body. 200: the order with its new `status`. Packing sets `PACKING` and records who; completing sets `READY` and makes the order appear on the dispatch board.

Errors: `409 INVALID_TRANSITION` (`details.from`, `details.allowed[]`).

## POST /admin/orders/:id/items/:itemIndex/unavailable
Use while packing when a line is missing or damaged.

Body: `{ "reason": "damaged", "availableQty": 1 }`. `availableQty` optional: omit to remove the line, set a lower number to reduce it. 200:
```json
{
  "data": {
    "order": { "…": "admin order with updated items and amountDue" },
    "refund": { "id": "ref_1", "amount": 3200, "status": "requested" },
    "notifiedCustomer": true
  }
}
```
Stock for the removed quantity is restored. **Delivery fee and surcharges never increase**, even if the order now falls under a free-delivery tier. For prepaid orders a refund of the difference is created automatically ([F16](F16-cancellations-and-refunds.md)); for COD the order's `amountDue` drops. If every line is unavailable, the order is cancelled.

## PUT /admin/orders/:id/items/:itemIndex
Body: `{ "qty": 1 }` (only a reduction, only before `PICKED_UP`). 200: the order. Same money rules as above.

## POST /admin/orders/:id/cancel
Body: `{ "reason": "Customer called to cancel" }` (required). Allowed before `PICKED_UP`, including `READY` and `ASSIGNED`. 200: the order. Stock is restored; prepaid orders get a refund; an assigned rider is notified and the assignment is cancelled.

Errors: `409 ORDER_NOT_CANCELLABLE` (already picked up: use failed delivery or handover, [F18](F18-dispatch-and-assignment.md)).

## POST /admin/orders/:id/force-status
Body: `{ "to": "READY", "reason": "Order was packed but not marked" }`. 200: the order. Always audited. Use rarely.

## POST /admin/orders/:id/notes
Body: `{ "text": "Customer wants ripe tomatoes" }`. 201: the note.

## GET /admin/orders/:id/print
Query: `type=bill|slip`. 200: `Content-Type: text/html` — a printable 80 mm thermal bill, or a packing slip with a checklist. Open it in a new tab and call `window.print()`. (GST invoice format is not specified yet; see the open questions in F13.)

## Implementation notes (backend, orders module)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. A path id that is not an id, or an `itemIndex` that is not a number, is `404` / `400`.
- **One writer.** Every status change goes through one function that checks the move against the state machine, updates the order only if it is still in the status it was read in (a concurrent change is retried once, then `409`), and writes the order event and the change-feed entry in the same transaction. The same function is behind the delivery modules' order port, so a rider's pickup and an admin's confirm follow the same rules. `409 INVALID_TRANSITION` carries `from`, `to` and `allowed[]`.
- **Cancelling** (`CANCELLED`): the stock goes back, the coupon is given back when the whole group is cancelled, a rider assigned to the order is released and told, a prepaid customer is refunded (items less their discount, plus the fees only when every other order of the group is cancelled too), and the customer is notified. After pickup it is `409 ORDER_NOT_CANCELLABLE`.
- **Missing items.** `unavailable` and the quantity edit take quantity off a line only while the order is `PLACED` to `READY`. The refunded or deducted amount is the line value less its pro-rata discount; cash orders' `amountDue` drops, prepaid orders get a refund, the stock for the removed quantity is restored once (a repeat does nothing), and the delivery fee and surcharges never change. An order with no lines left is cancelled.
- **Changes feed.** `GET /admin/orders/changes` returns the position of the feed on the first call (no `since`) and no orders. After that, one entry per changed order since the cursor (`created` if it was created in that window). The cursor is `c_<n>`, numbered in the same transaction as the change so none is skipped. `ackStatus` is `null` for now; `delayed` is true when an order has waited longer than `slaMinutes` (confirm 5, pack 15, assign 5).
- **List.** `q` matches order number, customer name or phone; `status` takes a comma list; `riderId` matches orders the rider is working now; `flagged` matches offline deliveries. Scoped staff see only their warehouses (`403` for another warehouse).
- **Print** returns an 80 mm HTML page (`type=bill` by default, or `slip`); every value is escaped. **GST invoice format is not built.**
- **Force status** accepts any status, records `forced: true` in the event and the audit log, and runs the usual effects (a forced `CANCELLED` restocks and refunds like a normal cancel).
