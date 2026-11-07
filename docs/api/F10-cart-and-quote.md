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
| `GET` | `/tips/options` | Public | Quick tip amounts and the limit for a zone |

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
`scheduledWindow` is used for pre-orders: `{ "start": "2026-11-06T07:00:00+05:30", "end": "2026-11-06T09:00:00+05:30" }` ([F17](F17-hours-preorders-and-ops-mode.md)). `paymentMethod` (`cod` or `online`) only checks eligibility. `tipAmount` (whole paise, default 0) adds a rider tip, see below.

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

## Implementation notes (backend, cart module)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. `OUT_OF_ZONE`, `MIN_ORDER_NOT_MET`, `COUPON_INVALID` and `COD_NOT_ALLOWED` are `422`; `ZONE_PAUSED`, `STORE_CLOSED`, `ITEM_UNAVAILABLE` and `ZONE_CHANGE_UNCONFIRMED` are `409`; `QUOTE_EXPIRED` is `410`.
- **`PUT /cart`** needs a place to price the cart: `addressId` (a deliverable address of the customer) or `zoneId`; otherwise `400`. A lower `clientRev` than the one held is ignored and the server cart is returned. More than 40 different items is `400`. Repeats of one variant are added together. `corrections[]` reasons: `max_qty` (10 per line, or the offering's own cap), `out_of_stock` (qty becomes what is in stock), `not_sold_in_zone`. `price_changed` is not reported because prices are never stored in the cart. `imageUrl` is `null` for now.
- **`GET /cart`** prices live and marks a line `available: false` when it cannot be supplied now; it changes nothing.
- **Zone change.** An address in another zone re-prices the lines there; `zoneChange` lists what was removed and re-priced and stays on the cart until `POST /quotes` is sent with `acceptZoneChange: true`. Until then a quote answers `409 ZONE_CHANGE_UNCONFIRMED` with the same `zoneChange`.
- **Allocation.** One warehouse with every line wins (nearest first); otherwise the warehouse covering the most remaining lines goes first, up to `maxSplitsPerOrder` (2). A line is never split. Failing that, `409 ITEM_UNAVAILABLE` lists the lines that cannot be supplied together. Only enabled warehouses that are open now take part.
- **The bill.** One delivery fee for the group, split between the deliveries pro-rata (kept on the stored quote as `allocatedDiscount` and `allocatedCharges`, which add up to the totals). ETA per delivery is pack 5 + rider arrival 5 + travel + the extra minutes of any surcharge. The minimum order is the zone's fee rule `minOrder`.
- **Quote** is kept for 300 s and for a day afterwards (so a late order is told it expired). It is private to the customer (`404` for anyone else). `scheduledWindow` is stored but pre-order slots are checked by the hours module (F17).
- **For Dev 1 (orders).** Place an order from `cart.quotes.get(userId, quoteId)`, re-run `cart.quotes.build(...)` and compare to detect `QUOTE_CHANGED`, hold the coupon with `pricing.service.hold`, and take the quote with the store's `claimQuote`. `POST /orders/:id/reorder` uses `cart.cart.reorder`.

## Rider tips
`GET /tips/options?zoneId=` (no login) returns `{ "data": { "enabled": true, "presets": [1000, 2000, 5000], "max": 20000 } }` for the checkout screen. A customer may pick a preset or type any amount up to `max`.

Send `tipAmount` when creating the quote. It appears in `pricing.charges` as `{ "type": "tip", "label": "Rider tip", "amount": 2000 }`, is included in `pricing.total`, is paid with the order (online, or in cash at the door), and is shared over the deliveries of a split order like a fee, so each rider's tip matches their own delivery. A tip is never waived by free delivery and is not capped like a surcharge. Errors: `400 VALIDATION_ERROR` (`details.field = "tipAmount"`) when tips are switched off or the amount is above `max`.

If an order is cancelled before pickup, its tip is refunded with it, even when another delivery of the same group goes ahead. A tip is the rider's, not the shop's: it is left out of the dashboard revenue, the sales report and a customer's lifetime value. The owner controls it in settings: `delivery.tipsEnabled`, `tipPreset1`, `tipPreset2`, `tipPreset3` and `tipMaxAmount` ([F25](F25-admin-panel-settings-and-reports.md)).
