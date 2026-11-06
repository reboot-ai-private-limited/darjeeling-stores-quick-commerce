# API · F07 Notify Me (Back in Stock)

Spec: [F07](../catalog/07-notify-me.md) · Conventions: [00](00-conventions.md)

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/notify-me` | Customer | Subscribe to a back-in-stock alert |
| `GET` | `/notify-me` | Customer | My active subscriptions |
| `DELETE` | `/notify-me/:id` | Customer | Cancel a subscription |
| `GET` | `/admin/notify-demand` | Admin `notify_demand:view` | Demand list for restocking |

## POST /notify-me
Body:
```json
{ "zoneId": "zone_1", "productId": "prod_1", "variantId": "var_2", "channels": ["push", "whatsapp"] }
```
`variantId` optional (omit or send `null` for any size). `channels` defaults to both; it must have at least one of `push` and `whatsapp`, and repeats are removed. 201:
```json
{ "data": { "id": "sub_1", "zoneId": "zone_1", "productId": "prod_1", "variantId": "var_2", "channels": ["push", "whatsapp"], "status": "waiting", "createdAt": "2026-11-05T10:30:00Z" } }
```
Errors: `409 CONFLICT` (already waiting for this item; returns the existing subscription in `details.subscription`) · `400 VALIDATION_ERROR` with `details.reason = "in_stock"` (the item is in stock; just add it to the cart) · `404 NOT_FOUND` (unknown, inactive or archived product or size, or the product is not sold in this zone) · `401 UNAUTHORIZED`.

"In stock" is judged for the whole zone: a size is in stock when any warehouse of the zone can sell at least one unit. With no `variantId`, the item counts as in stock when any size is. A size and "any size" are separate subscriptions.

## GET /notify-me
200 (only subscriptions still `waiting`, newest first):
```json
{ "data": [{ "id": "sub_1", "zoneId": "zone_1", "productId": "prod_1", "variantId": "var_2", "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "channels": ["push", "whatsapp"], "status": "waiting", "createdAt": "2026-11-05T10:30:00Z" }], "meta": { "count": 1 } }
```
`variantId` and `variantLabel` are `null` for "any size".

## DELETE /notify-me/:id
200: `{ "data": { "ok": true } }`. Only your own subscriptions; anyone else's id answers `404 NOT_FOUND`. Cancelling again, or cancelling one that was already notified, is a no-op that still answers 200. After cancelling, the customer can subscribe again.

## What happens next
When stock in any warehouse of the zone goes from 0 to above 0, the customer gets a push and a WhatsApp message with the product image and a deep link, and the subscription becomes `notified`. See [F23](F23-notifications.md). The deep link opens `product/<productId>` in the app.

A customer waiting for one size is told only when that size returns; a customer waiting for any size is told when the first size returns. Each subscription is closed after one message. Customers in other zones, and cancelled subscriptions, are never told.

## GET /admin/notify-demand
Query: `?zoneId=&warehouseId=`. `warehouseId` narrows the list to that warehouse's zone. Scoped staff only see zones of their warehouses and get `403 FORBIDDEN` for a `zoneId` or `warehouseId` outside them. Only `waiting` subscriptions count. Rows are ordered by `waiting` (most wanted first), then oldest request, at most 500. 200:
```json
{
  "data": [
    { "zoneId": "zone_1", "productId": "prod_1", "variantId": "var_2", "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "waiting": 14, "oldestRequestAt": "2026-11-04T08:10:00Z" }
  ],
  "meta": { "count": 1 }
}
```

`variantId` and `variantLabel` are `null` for customers waiting for any size.

## Implementation notes (backend, D2-5)

- **Auth.** The customer routes need a logged-in customer; the staff route needs `notify_demand:view`. The module takes a `customer` resolver (who is calling) from composition, and until the identity session is connected every customer route answers `401`.
- **Trigger.** The module listens to the `stock.zone_availability_changed` event from the offerings module, which fires only when a size goes from none to some in the whole zone. Stock adjustments, stock-takes, bulk quantity changes, imports and orders giving stock back all use the same path.
- **Exactly once.** For each waiting subscription the module marks it `notified` and writes its message to the `back_in_stock_outbox` collection in one transaction. A repeated or simultaneous event finds nothing left to claim, so nobody is messaged twice.
- **Delivery.** Until the notifications module (F23, D2-2) exists, messages wait in `back_in_stock_outbox` as `pending`. The F23 job reads them with `pendingMessages()` and reports `markDelivered()` or `markFailed()`. A message holds the product name, size label, first image id, channels and the `product/<productId>` deep link.
- **Uniqueness.** A unique index on customer, zone, product and size (only while `waiting`) stops duplicates even under simultaneous requests.
- **Known shortcuts.** `notifyMeThrottlePerMinute` is not implemented because sending belongs to F23. The permission keys `notify_me:subscribe` and `notify_me:unsubscribe` are not checked: any logged-in customer may use these routes. A customer sees at most 200 waiting subscriptions.
