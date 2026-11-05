# API · F22 Rider Cash & Settlement

Spec: [F22](../delivery/22-rider-cash-and-settlement.md) · Conventions: [00](00-conventions.md)

The rider app records cash and doorstep UPI; the admin records the end-of-day deposit per warehouse. The ledger is **append-only**; corrections are adjustment entries with a reason. Each entry is tagged with the **order's warehouse**.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/rider/cash` | Rider | My cash in hand and today's entries |
| `POST` | `/rider/orders/:id/collect-cash` | Rider | Record cash collected for an order |
| `POST` | `/rider/orders/:id/collect-upi` | Rider | Record a doorstep UPI payment (unverified) |
| `GET` | `/admin/cash/riders` | Admin `cash:manage` | Cash in hand per rider and warehouse |
| `GET` | `/admin/cash/ledger` | Admin `cash:manage` | Ledger entries |
| `POST` | `/admin/cash/deposit` | Admin `cash:manage` | Record a deposit 🔒 |
| `POST` | `/admin/cash/adjust` | Admin `cash:manage` | Adjustment entry with a reason 🔒 |
| `GET` | `/admin/reconciliation` | Admin `cash:manage` | Items needing review |
| `POST` | `/admin/reconciliation/:id/resolve` | Admin `cash:manage` | Resolve a reconciliation item 🔒 |
| `POST` | `/admin/orders/:id/fix-collection` | Admin `orders:manage` | Correct a wrong collection record 🔒 |

## GET /rider/cash
200:
```json
{
  "data": {
    "cashInHand": 24600,
    "byWarehouse": [{ "warehouseId": "wh_1", "warehouseName": "Chowrasta store", "amount": 15800 }, { "warehouseId": "wh_2", "warehouseName": "Mall Road store", "amount": 8800 }],
    "deliveredToday": 7,
    "pendingUpi": [{ "orderId": "ord_4", "orderNo": "DS-240004", "amount": 5400, "status": "upi_unverified" }],
    "entries": [{ "id": "led_1", "type": "collected", "amount": 8800, "orderNo": "DS-240001-A", "warehouseId": "wh_1", "at": "2026-11-05T11:02:05Z" }]
  }
}
```
UPI payments are **not** in `cashInHand` until the admin verifies them.

## POST /rider/orders/:id/collect-cash
Call at the door for a COD order, before `deliver`. Body: `{ "amount": 8800, "collectedAt": "2026-11-05T11:02:05Z" }`. `amount` must equal the order's `amountDue`. 200:
```json
{ "data": { "orderId": "ord_1", "paymentStatus": "cod_collected", "ledgerEntryId": "led_1", "cashInHand": 24600 } }
```
Repeating the call for the same order does not add cash twice: it returns the first result with `"duplicate": true`.

Errors:
- `409 CONFLICT` with `details.reason: "already_paid"`: the customer paid online while you were on the way. **Do not take the cash.** If cash was already taken, send it anyway through offline sync and it is recorded as overpaid for refund.
- `422 PAYMENT_MISMATCH` (`details.amountDue`) · `409 INVALID_TRANSITION` (order not `ARRIVED`) · `404 NOT_FOUND`.

## POST /rider/orders/:id/collect-upi
After the customer pays the doorstep QR (built on the phone from the bundle, [F21](F21-offline-and-low-network.md)). The app cannot confirm the payment, so the entry is **unverified**. Body: `{ "amount": 8800, "note": "Paid by GPay 11:02", "collectedAt": "2026-11-05T11:02:05Z" }`. 200:
```json
{ "data": { "orderId": "ord_1", "paymentStatus": "upi_unverified", "collection": { "method": "upi_unverified", "amount": 8800 } } }
```
Not counted as cash in hand. The admin reconciles it against the bank statement. Same errors and duplicate behaviour as above.

## GET /admin/cash/riders
Query: `warehouseId`, `zoneId`. 200:
```json
{
  "data": [{ "riderId": "rider_1", "name": "Pema Sherpa", "cashInHand": 24600, "byWarehouse": [{ "warehouseId": "wh_1", "amount": 15800 }, { "warehouseId": "wh_2", "amount": 8800 }], "lastDepositAt": "2026-11-04T20:10:00Z" }],
  "meta": { "totalInHand": 24600 }
}
```

## GET /admin/cash/ledger
Query: `riderId`, `warehouseId`, `type=collected|deposit|adjustment`, `from`, `to`, `limit`, `cursor`. 200:
```json
{
  "data": [{ "id": "led_2", "riderId": "rider_1", "warehouseId": "wh_1", "type": "deposit", "amount": -15800, "orderId": null, "balanceAfter": 8800, "note": "Evening handover", "by": "user_9", "at": "2026-11-05T20:05:00Z" }],
  "meta": { "nextCursor": null }
}
```
Collected entries are positive and deposits negative. `flags` may be `overpaid` or `unmatched`.

## POST /admin/cash/deposit
Body: `{ "riderId": "rider_1", "warehouseId": "wh_1", "amount": 15800, "note": "Evening handover" }`. A warehouse manager can only deposit for their own warehouse; the owner can do any. 201: the ledger entry with the rider's new `balanceAfter`. Errors: `422 VALIDATION_ERROR` (`amount` larger than the cash held for that warehouse) · `403 FORBIDDEN` (scope).

## POST /admin/cash/adjust
Body: `{ "riderId": "rider_1", "warehouseId": "wh_1", "amount": -200, "note": "Short by ₹200, rider will repay" }`. `note` is **required**. 201: the ledger entry (`type: "adjustment"`). Entries are never edited or deleted.

## GET /admin/reconciliation
Query: `type`, `status=open|resolved`, `warehouseId`. 200:
```json
{
  "data": [
    { "id": "rec_1", "type": "upi_unverified", "orderNo": "DS-240004", "riderName": "Pema Sherpa", "amount": 5400, "at": "2026-11-05T11:05:00Z", "status": "open" },
    { "id": "rec_2", "type": "overpaid", "orderNo": "DS-240007", "riderName": "Tashi Lepcha", "amount": 9900, "at": "2026-11-05T12:10:00Z", "status": "open" },
    { "id": "rec_3", "type": "unmatched", "orderNo": "DS-240009", "riderName": "Karma Bhutia", "amount": 3200, "at": "2026-11-05T13:00:00Z", "status": "open" }
  ],
  "meta": { "openCount": 3, "nextCursor": null }
}
```
`type`: `upi_unverified` (match with the bank), `overpaid` (customer paid online and cash was also taken: refund), `unmatched` (cash on a cancelled or reassigned order).

## POST /admin/reconciliation/:id/resolve
Body depends on `type`:
```json
{ "outcome": "verified", "bankReference": "UPI/4381…", "note": "Matched in bank statement" }
```
```json
{ "outcome": "refund", "note": "Created refund" }
```
`outcome`: `verified` / `not_received` (UPI) · `refund` / `keep` (overpaid; `refund` creates a refund, [F16](F16-cancellations-and-refunds.md)) · `adjust` (unmatched; creates an adjustment). `not_received` raises a discrepancy against the rider. 200: the item with `status: "resolved"`. Audited.

## POST /admin/orders/:id/fix-collection
Corrects a mistaken collection record. Body: `{ "method": "cash", "amount": 8800, "reason": "Rider entered the wrong order" }`. 200: the order. The ledger gets a matching adjustment, never an edit. Audited.
