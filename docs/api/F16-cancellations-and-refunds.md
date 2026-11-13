# API · F16 Cancellations & Refunds

Spec: [F16](../orders/16-cancellations-and-refunds.md) · Conventions: [00](00-conventions.md)

Refunds for online orders can be sent back through Razorpay with one click (**Refund via Razorpay**, `pay-via-razorpay`); any refund can also be paid outside the system (Razorpay dashboard, UPI or cash) and recorded with **Mark refund done**. Admin cancel of an order is `POST /admin/orders/:id/cancel` in [F14](F14-order-lifecycle-and-packing.md).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/orders/:id/cancel` | Customer | Cancel my order (before packing starts) |
| `POST` | `/orders/:id/refund-request` | Customer | Ask for a refund (missing or damaged item) |
| `GET` | `/refunds` | Customer | My refunds |
| `GET` | `/refunds/:id` | Customer | One refund |
| `GET` | `/admin/refunds` | Admin `refunds:manage` | Pending and past refunds |
| `GET` | `/admin/refunds/:id` | Admin `refunds:manage` | One refund with photos |
| `POST` | `/admin/refunds` | Admin `refunds:manage` | Create a refund by hand 🔒 |
| `POST` | `/admin/refunds/:id/approve` | Admin `refunds:manage` | Approve a customer request 🔒 |
| `POST` | `/admin/refunds/:id/reject` | Admin `refunds:manage` | Reject with a reason 🔒 |
| `POST` | `/admin/refunds/:id/pay-via-razorpay` | Admin `refunds:manage` | Send the money back through Razorpay and close the refund 🔒 |
| `POST` | `/admin/refunds/:id/mark-done` | Admin `refunds:manage` | Record that it was paid 🔒 |

## Object: refund

```json
{
  "id": "ref_1",
  "groupId": "grp_1",
  "orderId": "ord_1",
  "orderNo": "DS-240001-A",
  "amount": 3200,
  "reason": "item_unavailable",
  "source": "auto",
  "status": "requested",
  "customerNote": null,
  "photos": [],
  "items": [{ "orderItemIndex": 0, "qty": 1 }],
  "rejectReason": null,
  "method": null,
  "reference": null,
  "note": null,
  "createdAt": "2026-11-05T10:36:00Z",
  "markedDoneAt": null
}
```
- `reason`: `cancelled`, `item_unavailable`, `late_payment`, `damaged_item`, `missing_item`, `overpaid`, `other`.
- `source`: `auto`, `customer_request`, `admin`.
- `status`: `requested` → `approved` → `done`, or `rejected`. (Auto refunds can go `requested` → `done` directly.)
- `method` (when done): `razorpay_dashboard`, `upi`, `cash`.
- Photos are `[{ "mediaId": "media_40" }]`; read them with `GET /media/:id/url` ([F24](F24-media-storage.md)).

## POST /orders/:id/cancel
Body: `{ "reason": "Ordered by mistake" }`. Allowed while the child is `PENDING_PAYMENT`, `PLACED` or `CONFIRMED` (setting `customerCancelUntil`). 200:
```json
{
  "data": {
    "order": { "id": "ord_1", "status": "CANCELLED" },
    "refund": { "id": "ref_2", "amount": 6400, "status": "requested" },
    "deliveryFeeRefunded": false
  }
}
```
- **Split groups:** cancelling one child refunds that child's items minus its discount share. The delivery fee and surcharges stay (the other delivery still happens), unless **every** child is cancelled before dispatch, in which case `deliveryFeeRefunded` is `true` and the whole bill is refunded.
- `refund` is `null` for COD orders (nothing was paid).

Errors: `409 ORDER_NOT_CANCELLABLE` (`details.currentStatus`) · `404 NOT_FOUND`.

## POST /orders/:id/refund-request
Only after delivery, within `refundWindowHours`, and for eligible categories (for example perishables). Body:
```json
{
  "reason": "damaged_item",
  "items": [{ "orderItemIndex": 0, "qty": 1 }],
  "customerNote": "Tomatoes were crushed",
  "photoMediaIds": ["media_40"]
}
```
`photoMediaIds` are required when `refundPhotoRequired` is on (upload with F24 first). 201: the refund (`status: "requested"`).

Errors: `422 REFUND_NOT_ALLOWED` (`details.reason`: `window_expired`, `category_not_eligible`, `photo_required`, `not_delivered`) · `422 REFUND_EXCEEDS_AMOUNT` · `409 CONFLICT` (a request for this item already exists).

## GET /refunds · GET /refunds/:id
200: `{ "data": [<refund>], "meta": { "nextCursor": null } }`. Show the status (`requested`, `approved`, `done`, `rejected`) from the server only.

## GET /admin/refunds
Query: `status=requested|approved|done|rejected`, `source`, `warehouseId`, `from`, `to`, `limit`, `cursor`. 200: `{ "data": [<refund> + "customer": { "name", "phone" }, "paymentMethod"], "meta": { "pendingCount": 4, "nextCursor": null } }`. `pendingCount` drives the admin badge.

## POST /admin/refunds
Body: `{ "orderId": "ord_1", "amount": 1500, "reason": "other", "note": "Goodwill for late delivery" }` → 201: the refund (`source: "admin"`). Errors: `422 REFUND_EXCEEDS_AMOUNT`.

## POST /admin/refunds/:id/approve · reject
Approve: no body. Reject: `{ "reason": "Photo does not show damage" }` (required). 200: the refund. The customer is notified. Errors: `409 CONFLICT` (wrong status).

## POST /admin/refunds/:id/pay-via-razorpay
No body. Only for a refund on an order paid online that is still `requested` or `approved`. It refunds the captured Razorpay payment of the order (Razorpay is given the refund id as an idempotency key, so a repeat click never refunds twice), then closes the refund as `status: "done"`, `method: "razorpay_api"`, `reference` = the Razorpay refund id. 200: the refund. Errors: `409 CONFLICT` with `details.reason` `not_online` (cash order), `no_captured_payment` (no online payment was received) or `exceeds_payment`; `409` (already closed); `422 REFUND_EXCEEDS_AMOUNT`; `503 SERVICE_UNAVAILABLE` (Razorpay not set up or unreachable; the refund stays open).

## POST /admin/refunds/:id/mark-done
Body:
```json
{ "method": "razorpay_dashboard", "reference": "rfnd_Nz3", "note": "Refunded from dashboard" }
```
200: the refund with `status: "done"`, `markedDoneAt` and the order's `refundStatus: "done"`. The customer gets push and WhatsApp. Errors: `409 CONFLICT` (already done) · `422 REFUND_EXCEEDS_AMOUNT`. Duplicate clicks are safe.

## Implementation notes (backend, refunds module)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. `REFUND_NOT_ALLOWED` and `REFUND_EXCEEDS_AMOUNT` are `422`; `ORDER_NOT_CANCELLABLE` is `409`.
- **Customer cancel** is allowed while the order is `PENDING_PAYMENT`, `PLACED` or `CONFIRMED` (setting `customerCancelUntil`: `CONFIRMED` by default, or `PLACED`). It uses the same cancellation as the admin: stock and any pre-order slot place go back, the coupon is given back when the whole group is cancelled, a rider assigned is released, and a prepaid customer gets a refund. The refund is the items less their discount share; **the delivery fee and surcharges are added only when every other order of the group is also cancelled** (`deliveryFeeRefunded: true`). A cash order has `refund: null`.
- **Automatic refunds** (cancellation, a removed item, a failed delivery given up, a late payment, cash taken twice) start as `requested` with `source: auto`. Each event makes one refund however often it is repeated (a unique key per event).
- **Asking after delivery.** The order must be `DELIVERED`, within `refundWindowHours` (24) of delivery; a photo is required when `refundPhotoRequired` is on (default); at most 3 photos, which must be the customer's own `refund_photo` uploads. The amount is the value of the lines asked for less their share of the discount. An item already asked for (and not rejected) is `409`. The total of refunds on an order (rejected ones left out) can never pass what the order cost: `422 REFUND_EXCEEDS_AMOUNT` with `details.refundable`. A `category_not_eligible` refusal is available through the `eligibility` option; by default everything is eligible.
- **Admin.** `approve` and `reject` only work on `requested` refunds, `mark-done` on `requested` or `approved` ones; each decision is made once even if clicked together (a later click is `409` and changes nothing). Marking done checks the refunds paid for the order never pass its cost. The order's `refundStatus` is kept in step: `pending` while any refund is open, `done` when only paid ones remain, `none` otherwise. Approve, reject and done are audited and notify the customer (push; WhatsApp too for done, template `refund_done_v1` to be approved in the Meta console). Scoped staff see and act on their own warehouses only.
