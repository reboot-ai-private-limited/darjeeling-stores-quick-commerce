# API · F13 Order Placement & Split Orders

Spec: [F13](../orders/13-order-placement-and-split-orders.md) · Conventions: [00](00-conventions.md)

One checkout creates an **order group** (one bill, one payment, one delivery fee, one delivery OTP). If one warehouse cannot supply everything, the group has several **child orders**, one per warehouse. The customer sees each child as its own order with its own status and ETA.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/orders` | Customer | Place an order from a quote |
| `GET` | `/orders` | Customer | My order history (groups) |
| `GET` | `/order-groups/:id` | Customer | One group with all its children |
| `GET` | `/orders/:id` | Customer | One child order in detail |
| `POST` | `/orders/:id/reorder` | Customer | Put a past order's items back into the cart |

Admin order endpoints are in [F14](F14-order-lifecycle-and-packing.md).

## Objects

```json
// Order group (customer view)
{
  "id": "grp_1",
  "groupNo": "DS-240001",
  "status": "ACTIVE",
  "paymentMethod": "cod",
  "paymentStatus": "cod_pending",
  "pricing": {
    "subtotal": 11000, "discount": 0,
    "charges": [{ "type": "delivery_fee", "label": "Delivery fee", "amount": 4000 }, { "type": "surcharge_rain", "label": "Rain surcharge", "amount": 1500 }],
    "tax": 0, "total": 16500, "taxInclusive": true
  },
  "address": { "line1": "Cedar Villa, 2nd floor", "landmark": "Opposite Planters Club gate", "locality": "Chowrasta", "city": "Darjeeling", "pincode": "734101", "contactName": "Asha Rai", "contactPhone": "+919876543210", "location": { "lat": 27.0410, "lng": 88.2663 } },
  "deliveryOtp": "4271",
  "trackingUrl": "https://example.com/track/tok_9f3a…",
  "children": [ "<child order>", "<child order>" ],
  "createdAt": "2026-11-05T10:30:00Z"
}
```
- Group `status`: `PENDING_PAYMENT`, `ACTIVE`, `DELIVERED`, `PARTIAL` (some delivered, others cancelled), `CANCELLED`.
- `deliveryOtp` is the 4-digit code the customer reads to the rider. It is returned only to the owner and only while the order is active.

```json
// Child order (customer view)
{
  "id": "ord_1",
  "orderNo": "DS-240001-A",
  "groupId": "grp_1",
  "warehouseId": "wh_1",
  "status": "OUT_FOR_DELIVERY",
  "paymentStatus": "cod_pending",
  "refundStatus": "none",
  "items": [
    { "productId": "prod_1", "variantId": "var_2", "name": "Fresh Tomato (Local)", "variantLabel": "500 g", "unitPrice": 3200, "qty": 2, "lineTotal": 6400, "status": "ok", "imageUrl": "…/160.webp" }
  ],
  "itemsSubtotal": 6400,
  "amountDue": 7800,
  "promisedAt": "2026-11-05T11:05:00Z",
  "scheduledWindow": null,
  "rider": { "name": "Pema Sherpa", "phone": "+919800000010" },
  "voiceNoteExpired": false,
  "timeline": [
    { "status": "PLACED", "at": "2026-11-05T10:30:00Z" },
    { "status": "CONFIRMED", "at": "2026-11-05T10:30:05Z" },
    { "status": "PACKING", "at": "2026-11-05T10:33:00Z" },
    { "status": "READY", "at": "2026-11-05T10:38:00Z" },
    { "status": "ASSIGNED", "at": "2026-11-05T10:39:00Z" },
    { "status": "PICKED_UP", "at": "2026-11-05T10:44:00Z" },
    { "status": "OUT_FOR_DELIVERY", "at": "2026-11-05T10:44:10Z" }
  ]
}
```
- Child `status`: `PENDING_PAYMENT`, `PLACED`, `CONFIRMED`, `PACKING`, `READY`, `ASSIGNED`, `PICKED_UP`, `OUT_FOR_DELIVERY`, `ARRIVED`, `DELIVERED`, `CANCELLED`, `FAILED_DELIVERY`.
- `paymentStatus`: `pending`, `paid`, `failed`, `cod_pending`, `cod_collected`, `upi_unverified`. `refundStatus`: `none`, `pending`, `done`.
- `amountDue` is the COD amount for this child (0 when prepaid or already paid).
- `rider` is `null` until an order is assigned. Item `status` is `ok` or `unavailable` (with `unavailableReason`).
- Customers get status changes by polling `GET /orders/:id/tracking` ([F20](F20-eta-and-live-tracking.md)) and by push.

## POST /orders
Headers: `Idempotency-Key: <uuid>` (**required**). Body:
```json
{
  "quoteId": "quote_1",
  "paymentMethod": "cod",
  "deliveryNotes": "Ring the bell twice",
  "voiceMediaId": "media_30",
  "housePhotoMediaId": null
}
```
`paymentMethod`: `cod` or `online`. The voice note and photo may be uploaded after placement; attach them later with the media endpoints ([F24](F24-media-storage.md)).

201 (COD): the **order group** above (children `PLACED`, or `CONFIRMED` when auto-confirm is on).

201 (online): the group in `PENDING_PAYMENT` plus the data to open Razorpay checkout:
```json
{
  "data": {
    "group": { "…": "order group, status PENDING_PAYMENT" },
    "payment": { "provider": "razorpay", "razorpayKeyId": "rzp_live_xxx", "razorpayOrderId": "order_Nz1", "amount": 16500, "currency": "INR", "expiresAt": "2026-11-05T10:45:00Z" }
  }
}
```
COD returns the same envelope with `"payment": null`.

Repeating the same `Idempotency-Key` returns the same group (so a double tap or a lost response is safe).

Errors:
- `410 QUOTE_EXPIRED` · `409 QUOTE_CHANGED` (`details.quote` = the new quote)
- `409 ITEM_UNAVAILABLE` / `409 INSUFFICIENT_STOCK` (`details.lines[]`; stock changed since the quote)
- `409 STORE_CLOSED` · `409 ZONE_PAUSED` · `422 COD_NOT_ALLOWED`
- `422 IDEMPOTENCY_KEY_REUSED` · `404 NOT_FOUND` (quote)

## GET /orders
Query: `status=active|past`, `limit`, `cursor`. 200:
```json
{
  "data": [
    {
      "groupId": "grp_1", "groupNo": "DS-240001", "status": "ACTIVE", "total": 16500, "createdAt": "2026-11-05T10:30:00Z",
      "children": [
        { "id": "ord_1", "orderNo": "DS-240001-A", "status": "OUT_FOR_DELIVERY", "itemCount": 2, "promisedAt": "2026-11-05T11:05:00Z" },
        { "id": "ord_2", "orderNo": "DS-240001-B", "status": "PACKING", "itemCount": 1, "promisedAt": "2026-11-05T11:10:00Z" }
      ]
    }
  ],
  "meta": { "nextCursor": null }
}
```

## GET /order-groups/:id · GET /orders/:id
200: the group or child object above. Another customer's id returns `404 NOT_FOUND`.

## POST /orders/:id/reorder
200: `{ "data": { "cart": <cart>, "corrections": [{ "productId": "prod_3", "variantId": "var_9", "reason": "out_of_stock", "qty": 0 }] } }`. Items are added to the cart at today's prices and stock; nothing is ordered.

## Implementation notes (backend, orders module)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. `IDEMPOTENCY_KEY_REUSED`, `COD_NOT_ALLOWED` are `422`; `QUOTE_CHANGED`, `ITEM_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `STORE_CLOSED`, `ZONE_PAUSED` are `409`; `QUOTE_EXPIRED` is `410`. A missing `Idempotency-Key` is `400`.
- **Response.** `POST /orders` always answers `201 { group, payment }`; `payment` is `null` for cash and the checkout data for online orders (from the payments module, F15).
- **Placing.** The quote is worked out again from its own lines. If the total, the charges or the allocation differ, a new quote is saved and returned in `409 QUOTE_CHANGED` (`details.quote`); nothing is taken. Otherwise, in order: the coupon is held (atomic against its limits), the stock is reserved for the whole group in one go (all or nothing), the quote is marked used, and the group and its children are saved in one transaction. Any failure gives the coupon and the stock back. A quote can be used once (`409`, `details.reason: quote_used`).
- **Idempotency.** `(customer, Idempotency-Key)` is unique in the database, so a repeat, or three taps at once, returns the same group and takes stock once. The same key with a different body is `422 IDEMPOTENCY_KEY_REUSED`.
- **Children** are `PLACED` (`CONFIRMED` when `confirmMode` is `auto`, the default) for cash, `PENDING_PAYMENT` with an expiry (`paymentWindowMinutes`, 15) for online. Cash orders confirm their stock hold at once; online holds expire on their own. Order numbers are `DS-<n>` for a single order and `DS-<n>-A`, `-B` when split. `amountDue` is the child's share of items, discount and fees for cash orders and 0 for prepaid ones.
- **Delivery code.** One 4-digit code per group, kept encrypted (AES-256-GCM, key from `orderSettings.otpKeyHex`; a fixed development key is used only if none is set, so set it in production). Customers see it only while the group is active. A wrong try is counted per group and locks at 5.
- **Files.** The address's voice note and photo are copied onto each child (F24) and scheduled for deletion after the order ends. `trackingUrl` is set when a tracking secret and `orderSettings.trackingBaseUrl` are configured.
- **Reading.** `GET /orders?status=active|past` pages newest first (`status` is about whether any child is still in progress). Another customer's group or order is `404`. `reorder` adds the order's items back at today's prices (the cart keeps its address after an order, so this works at once).
- **For the payments module (F15/F16).** Pass `money` to `createDev2Modules`: `refund(...)` is called for cancellations and removed items, and `startPayment(group)` for online orders. Until then nothing is refunded and `payment` is `null`.
