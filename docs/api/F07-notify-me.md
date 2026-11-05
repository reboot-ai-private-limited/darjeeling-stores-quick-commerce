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
`variantId` optional (omit for any size). `channels` defaults to both. 201:
```json
{ "data": { "id": "sub_1", "zoneId": "zone_1", "productId": "prod_1", "variantId": "var_2", "channels": ["push", "whatsapp"], "status": "waiting", "createdAt": "2026-11-05T10:30:00Z" } }
```
Errors: `409 CONFLICT` (already waiting for this item; returns the existing subscription in `details.subscription`) · `422 VALIDATION_ERROR` (the item is in stock; just add it to the cart) · `404 NOT_FOUND`.

## GET /notify-me
200:
```json
{ "data": [{ "id": "sub_1", "productId": "prod_1", "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "status": "waiting" }], "meta": { "count": 1 } }
```

## DELETE /notify-me/:id
200: `{ "data": { "ok": true } }`. Only your own subscriptions.

## What happens next
When stock in any warehouse of the zone goes from 0 to above 0, the customer gets a push and a WhatsApp message with the product image and a deep link, and the subscription becomes `notified`. See [F23](F23-notifications.md). The deep link opens `product/<productId>` in the app.

## GET /admin/notify-demand
Query: `?zoneId=&warehouseId=`. Scoped staff only see zones of their warehouses. 200:
```json
{
  "data": [
    { "zoneId": "zone_1", "productId": "prod_1", "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "waiting": 14, "oldestRequestAt": "2026-11-04T08:10:00Z" }
  ],
  "meta": { "count": 1 }
}
```
