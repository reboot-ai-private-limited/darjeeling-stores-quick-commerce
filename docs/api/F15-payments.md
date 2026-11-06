# API · F15 Payments

Spec: [F15](../orders/15-payments.md) · Conventions: [00](00-conventions.md)

Three ways to pay: online (Razorpay UPI or card), cash on delivery, and "pay online later" for a COD order. **The Razorpay webhook is the source of truth**; the client's success message is only provisional. Placing the order is in [F13](F13-order-placement-and-split-orders.md); cash and doorstep UPI collection by the rider is in [F22](F22-rider-cash-and-settlement.md).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/payments/verify` | Customer | Provisional check after Razorpay checkout |
| `POST` | `/payments/retry` | Customer | Start a new payment attempt before expiry |
| `GET` | `/order-groups/:id/payment` | Customer | Poll "confirming payment" status |
| `POST` | `/orders/:id/pay-link` | Customer | Pay a COD order online before cash is collected |
| `POST` | `/webhooks/razorpay` | Webhook | Razorpay events (authoritative) |
| `GET` | `/admin/payments` | Admin `payments:view` | List payments |
| `GET` | `/admin/payments/:id` | Admin `payments:view` | One payment |
| `POST` | `/admin/payments/reconcile` | Admin `payments:manage` | Compare Razorpay with our records |
| `GET` | `/admin/payments/reconciliation` | Admin `payments:view` | Latest reconciliation results |
| `POST` | `/admin/payments/:id/mark-paid` | Admin `payments:manage` | Mark a stuck payment paid 🔒 |

## Object: payment

```json
{
  "id": "pay_1",
  "groupId": "grp_1",
  "method": "razorpay",
  "amount": 16500,
  "status": "captured",
  "razorpayOrderId": "order_Nz1",
  "razorpayPaymentId": "pay_Nz2",
  "signatureVerified": true,
  "failureReason": null,
  "capturedAt": "2026-11-05T10:31:20Z"
}
```
`method`: `razorpay`, `cod`, `razorpay_link`. `status`: `created`, `authorized`, `captured`, `failed`, `cod_pending`, `cod_collected`.

## Online flow (what the app does)
1. `POST /orders` with `paymentMethod: "online"` → group `PENDING_PAYMENT` + `payment.razorpayOrderId` ([F13](F13-order-placement-and-split-orders.md)).
2. Open Razorpay checkout (UPI intent opens GPay / PhonePe / Paytm).
3. On the SDK's success callback → `POST /payments/verify`.
4. Show "Confirming payment…" and poll `GET /order-groups/:id/payment` until `confirmed`. The webhook moves the children to `PLACED`.
5. On failure → `POST /payments/retry` until `expiresAt`. **Only expiry cancels the order**, not one failed attempt.

## POST /payments/verify
Headers: `Idempotency-Key`. Body:
```json
{ "groupId": "grp_1", "razorpayOrderId": "order_Nz1", "razorpayPaymentId": "pay_Nz2", "razorpaySignature": "9ef4…" }
```
200:
```json
{ "data": { "groupId": "grp_1", "state": "confirming", "provisional": true } }
```
`state`: `confirming` (signature ok, waiting for the webhook), `confirmed` (webhook already processed). Calling it twice is safe. Errors: `409 PAYMENT_MISMATCH` · `400 VALIDATION_ERROR` (bad signature) · `410 PAYMENT_EXPIRED`.

## GET /order-groups/:id/payment
200:
```json
{ "data": { "groupId": "grp_1", "paymentStatus": "paid", "state": "confirmed", "expiresAt": "2026-11-05T10:45:00Z" } }
```
`state`: `awaiting_payment`, `confirming`, `confirmed`, `failed`, `expired`. Poll about every 3 s for up to ~1 minute, then show "We'll notify you once the payment is confirmed".

## POST /payments/retry
Body: `{ "groupId": "grp_1" }`. 201:
```json
{ "data": { "razorpayKeyId": "rzp_live_xxx", "razorpayOrderId": "order_Nz9", "amount": 16500, "currency": "INR", "expiresAt": "2026-11-05T10:45:00Z" } }
```
Errors: `410 PAYMENT_EXPIRED` (order already cancelled and stock restored) · `409 CONFLICT` (already paid).

## POST /orders/:id/pay-link
Lets a COD customer pay online before the rider collects cash. Applies to the whole group. Body: `{ "method": "upi_intent" }` (or `link`). 201:
```json
{ "data": { "groupId": "grp_1", "amount": 16500, "paymentLinkId": "plink_1", "url": "https://rzp.io/i/abc", "upiIntentUrl": "upi://pay?pa=…", "expiresAt": "2026-11-05T12:00:00Z" } }
```
When the payment is captured, the group becomes `paid`, every child's `amountDue` becomes 0, and the rider app shows **"Already paid – do not collect"**. Errors: `409 CONFLICT` (cash already collected) · `404 NOT_FOUND`.

## POST /webhooks/razorpay
Called by Razorpay with the `X-Razorpay-Signature` header. Not for apps. The server:
- verifies the signature, stores the event id and ignores duplicates;
- on `payment.captured` → group `paid`, children `PLACED` (and `CONFIRMED` if auto-confirm);
- on `payment.failed` → records the failure, keeps the order open until expiry;
- on an amount mismatch → flags the admin, does not confirm;
- on payment after expiry or cancel → creates a `late_payment` refund ([F16](F16-cancellations-and-refunds.md)).

Always answers `200` quickly (processing is idempotent and retried by Razorpay).

## GET /admin/payments · GET /admin/payments/:id
Query: `status`, `method`, `groupNo`, `from`, `to`, `limit`, `cursor`. 200: `{ "data": [<payment> + "groupNo", "customerName"], "meta": { "nextCursor": null } }`. `:id` returns one with the last webhook summary in `lastEvent`.

## POST /admin/payments/reconcile
Body: `{ "date": "2026-11-05" }` (default today). 202: `{ "data": { "jobId": "job_1" } }`. Compares Razorpay captures with our records.

## GET /admin/payments/reconciliation
Query: `date`. 200:
```json
{
  "data": {
    "date": "2026-11-05",
    "matched": 42,
    "mismatches": [{ "type": "missing_in_db", "razorpayPaymentId": "pay_X", "amount": 9900 }, { "type": "amount_mismatch", "paymentId": "pay_7", "expected": 9900, "actual": 9800 }]
  }
}
```
`type`: `missing_in_db`, `missing_in_provider`, `amount_mismatch`, `status_mismatch`.

## POST /admin/payments/:id/mark-paid
Use only after checking the Razorpay dashboard. Body: `{ "razorpayPaymentId": "pay_Nz2", "note": "Verified in dashboard" }` → 200: the payment. Audited. Errors: `409 CONFLICT` (already captured).

## Implementation notes (backend, payments module)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422 (a bad checkout signature is `400` with `details.field: razorpaySignature`). `PAYMENT_MISMATCH` is `422` and `PAYMENT_EXPIRED` is `410`.
- **Setup.** Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`; without all three, creating a payment answers `503 SERVICE_UNAVAILABLE`. Order placement does not fail then: the online order is saved unpaid with `payment: null`, and `POST /payments/retry` makes the checkout when Razorpay is back. The webhook URL to register in the Razorpay dashboard is `/api/v1/webhooks/razorpay` (events: `payment.captured`, `payment.failed`, `order.paid`, `payment_link.paid`).
- **Source of truth.** `POST /payments/verify` checks the checkout signature (HMAC of `order_id|payment_id`), records the attempt as `authorized` and answers `confirming`; it never confirms the order. Only a signed webhook does that. The webhook's own signature is HMAC-SHA256 of the raw body; a bad one is `403`, and a good one always answers `200` with what was done in `data.result`: `paid`, `paid_cod`, `already_captured`, `duplicate`, `amount_mismatch`, `late_refund`, `overpaid_refund`, `duplicate_refund`, `failure_recorded`, `unknown_payment`, `ignored`.
- **Once only.** Each event id is stored (unique), and marking a payment captured is a conditional update, so repeated, simultaneous or re-sent events place the order once. If the event has no id header, a hash of the body stands in.
- **Capturing** (online): every order of the group moves `PENDING_PAYMENT` to `PLACED` (then `CONFIRMED` when confirmation is automatic), `paidAmount` is set, the stock hold becomes permanent and the expiry is cleared. A different amount than due confirms nothing: the payment is flagged `amount_mismatch` and the admin alerted. A capture after the orders were cancelled or expired is flagged `late_payment` and a `late_payment` refund is created; a second payment for an already paid group is refunded as `overpaid`.
- **Expiry.** A job (`payments.expire_overdue`, every minute) cancels online orders still unpaid after `paymentWindowMinutes` (15) and puts their stock back. After that `retry` and `verify` are `410`, and `GET /order-groups/:id/payment` says `expired`. A failed attempt does not cancel anything. `retry` makes a new Razorpay order (`attempt` counts up); `state` is `failed` after a failed attempt until the next one.
- **Pay online later** (`POST /orders/:id/pay-link`) works for a cash group with nothing collected: the amount is what is still due on all its active orders; asking again returns the same link while it is open (2 hours). When it is paid every order's `amountDue` becomes 0, the order shows `alreadyPaid`, and the rider's feed gets `payment_paid` (and `collect-cash` answers `409 already_paid`). If the cash was taken first, the online payment is refunded as `overpaid`.
- **Admin.** These screens are for staff who see every warehouse (a warehouse-scoped manager gets `403`), because a payment can span warehouses. `reconcile` compares one India-time day of captures at Razorpay with ours right away and answers `202` with the `jobId` of the saved result. `mark-paid` treats a stuck payment as received and is audited.
