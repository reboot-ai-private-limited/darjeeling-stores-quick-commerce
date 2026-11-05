# API · F10 Cart & Quote

Spec: [F10](../customer/10-cart-and-quote.md) · Conventions: [00](00-conventions.md)

The app keeps the cart on the device (instant taps) and syncs it to the server in the background. The server prices everything; **client totals are display-only**. A **quote** locks the bill and ETA for about 5 minutes; `POST /orders` ([F13](F13-order-placement-and-split-orders.md)) must use a valid quote.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/cart` | Customer | Current server cart, priced |
| `PUT` | `/cart` | Customer | Sync the whole cart from the device |
| `POST` | `/cart/coupon` | Customer | Apply a coupon |
| `DELETE` | `/cart/coupon` | Customer | Remove the coupon |
| `POST` | `/quotes` | Customer | Create a quote (bill + ETA per delivery) |
| `GET` | `/quotes/:id` | Customer | Read a quote |

## Object: cart

```json
{
  "zoneId": "zone_1",
  "addressId": "addr_1",
  "couponCode": null,
  "clientRev": 7,
  "items": [
    {
      "productId": "prod_1", "variantId": "var_2", "qty": 2,
      "name": "Fresh Tomato (Local)", "variantLabel": "500 g",
      "unitPrice": 3200, "lineTotal": 6400, "maxQty": 10, "available": true,
      "imageUrl": "https://cdn.example.com/…/320.webp"
    }
  ],
  "itemsSubtotal": 6400,
  "freeDelivery": { "threshold": 60000, "remaining": 53600 }
}
```
`freeDelivery` drives the "Add ₹X more for FREE delivery" bar (`null` when the zone has no free tier). The bill with fees is only computed in a quote.

## PUT /cart
Body: the **entire** cart. Last write wins per line.
```json
{
  "clientRev": 8,
  "addressId": "addr_1",
  "items": [
    { "productId": "prod_1", "variantId": "var_2", "qty": 2 },
    { "productId": "prod_3", "variantId": "var_9", "qty": 1 }
  ]
}
```
200:
```json
{
  "data": {
    "cart": { "…": "see object above" },
    "corrections": [
      { "productId": "prod_3", "variantId": "var_9", "reason": "out_of_stock", "qty": 0 },
      { "productId": "prod_1", "variantId": "var_2", "reason": "max_qty", "qty": 10 }
    ],
    "zoneChange": null
  }
}
```
- `corrections[]` lists lines the server trimmed or removed (`out_of_stock`, `max_qty`, `price_changed`, `not_sold_in_zone`). Show a small non-blocking toast on those cards.
- `zoneChange` is set when the chosen address is in a different zone than the cart was built in:
```json
{
  "zoneChange": {
    "fromZoneId": "zone_1", "toZoneId": "zone_2",
    "removed": [{ "productId": "prod_5", "variantId": "var_20", "name": "Local Cabbage", "reason": "not_sold_in_zone" }],
    "repriced": [{ "productId": "prod_1", "variantId": "var_2", "oldUnitPrice": 3200, "newUnitPrice": 3400 }]
  }
}
```
Show the changes and ask the customer to confirm before requesting a quote (`acceptZoneChange: true`).

Errors: `400 VALIDATION_ERROR` · `404 NOT_FOUND` (address).

## GET /cart
200: `{ "data": { "cart": <cart>, "corrections": [], "zoneChange": null } }`.

## POST /cart/coupon · DELETE /cart/coupon
Body: `{ "code": "WELCOME50" }`. 200: `{ "data": { "cart": <cart>, "coupon": { "code": "WELCOME50", "type": "flat", "description": "₹50 off" } } }`. The discount appears in the quote. Errors: `422 COUPON_INVALID` (`details.reason`). `DELETE` → 200 `{ "data": { "cart": <cart> } }`.

## POST /quotes
Body:
```json
{
  "addressId": "addr_1",
  "couponCode": null,
  "paymentMethod": "cod",
  "scheduledWindow": null,
  "acceptZoneChange": false
}
```
`scheduledWindow` is used for pre-orders: `{ "start": "2026-11-06T07:00:00+05:30", "end": "2026-11-06T09:00:00+05:30" }` ([F17](F17-hours-preorders-and-ops-mode.md)). `paymentMethod` (`cod` or `online`) only checks eligibility.

201:
```json
{
  "data": {
    "id": "quote_1",
    "expiresAt": "2026-11-05T10:35:00Z",
    "zoneId": "zone_1",
    "split": true,
    "allocation": [
      {
        "warehouseId": "wh_1", "warehouseName": "Chowrasta store",
        "lines": [{ "productId": "prod_1", "variantId": "var_2", "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "qty": 2, "unitPrice": 3200, "lineTotal": 6400 }],
        "itemsSubtotal": 6400,
        "eta": { "packMinutes": 5, "riderArrivalMinutes": 5, "travelMinutes": 10, "extraMinutes": 10, "promisedAt": "2026-11-05T11:05:00Z" }
      },
      {
        "warehouseId": "wh_2", "warehouseName": "Mall Road store",
        "lines": [{ "productId": "prod_8", "variantId": "var_30", "name": "Fresh Milk", "variantLabel": "500 ml", "qty": 1, "unitPrice": 4600, "lineTotal": 4600 }],
        "itemsSubtotal": 4600,
        "eta": { "packMinutes": 5, "riderArrivalMinutes": 5, "travelMinutes": 12, "extraMinutes": 10, "promisedAt": "2026-11-05T11:10:00Z" }
      }
    ],
    "pricing": {
      "subtotal": 11000,
      "discount": 0,
      "charges": [
        { "type": "delivery_fee", "label": "Delivery fee", "amount": 4000 },
        { "type": "surcharge_rain", "label": "Rain surcharge", "amount": 1500 }
      ],
      "tax": 0,
      "total": 16500,
      "taxInclusive": true
    },
    "payment": { "codAllowed": true, "codMaxAmount": 200000, "onlineAllowed": true },
    "scheduledWindow": null
  }
}
```
- **One bill and one delivery fee** even when `split` is true; each `allocation` entry becomes a separate delivery with its own ETA.
- Show "Arriving by `promisedAt`" for each delivery; the group arrives when the latest one does.

Errors:
- `422 OUT_OF_ZONE` · `409 ZONE_PAUSED` · `409 STORE_CLOSED` (`details.preOrderAvailable`)
- `422 MIN_ORDER_NOT_MET` (`details.minOrder`)
- `409 ITEM_UNAVAILABLE` (`details.lines[]`: lines no warehouse can supply together; ask the customer to adjust)
- `409 ZONE_CHANGE_UNCONFIRMED` (resend with `acceptZoneChange: true` after showing `details.zoneChange`)
- `422 COUPON_INVALID` · `422 COD_NOT_ALLOWED`

## GET /quotes/:id
200: the quote. `410 QUOTE_EXPIRED` when past `expiresAt`. A quote is private to its user.

## Typical checkout sequence
1. Customer taps +/−: update local cart instantly; background `PUT /cart`.
2. Customer opens the checkout sheet: create an `Idempotency-Key` (store it) and `POST /quotes`.
3. Customer taps **Place order**: `POST /orders { "quoteId": "quote_1" }` with that key (F13).
4. If `409 QUOTE_CHANGED`: show the new total from `details.quote` and ask the customer to accept, then place again with the new `quoteId`.
