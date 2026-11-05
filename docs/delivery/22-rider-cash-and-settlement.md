# F22 – Rider Cash & Settlement

Status: draft v3 · Folder: delivery · Depends on: F15, F19 · See also: F18 (batches), F21 (UPI unverified), F25 (reports)

## 1. Purpose
Track the COD cash each rider holds and settle it with the store at the end of the day, per warehouse, with reconciliation for UPI and sync oddities.

## 2. Cash ledger (COD)

1. Each `collect_cash` creates a ledger entry `+amount`, tagged with the **order's `warehouseId`**.
2. The rider sees **cash in hand** = collected − deposited, total and per warehouse.
3. End of day the rider hands the cash over; the admin records a **deposit** against a warehouse (`cash:manage`) → entry `−amount`, signed by the admin 🔒.
4. With scoped staff, a warehouse manager settles that warehouse's share; owner or `all` scope can settle any.
5. Differences show on the dashboard; corrections use an **adjustment** entry with a mandatory reason 🔒.

## 3. Items that need reconciliation

| Item | Where it comes from | Admin action |
|---|---|---|
| `upi_unverified` | Doorstep UPI QR (F15, F21). Not cash in hand | Match with the bank statement → `upi_verified`, or raise a discrepancy |
| `overpaid` | Customer paid online while the rider collected too | Create a refund (F16) |
| `unmatched` | Cash collected on a cancelled or reassigned order (sync conflict) | Resolve and adjust |
| Offline deliveries | `deliveredOffline` with an OTP or GPS flag (F21) | Review, then close |

## 4. Rules
- Balance is computed atomically per rider (last entry + delta) or recomputed by aggregation for reports.
- The ledger is append-only; no hard deletes.
- A batch with two warehouses: each order's cash is tagged with its own warehouse. The rider may hand all cash at one location; the admin records deposits per warehouse (assumption, confirm).
- A rider's cash-in-hand limit that blocks new assignments is not set by default.

## 5. Screens
- **Rider:** cash in hand and ledger, today's deliveries, pending UPI list.
- **Admin:** rider cash overview (balance per rider and warehouse) · record deposit · adjustment dialog · reconciliation lists (UPI unverified, overpaid, unmatched, offline reviews) · daily summary.

## 6. API
Rider: `GET /rider/cash`. Admin: `GET /admin/cash/riders` · `GET /admin/cash/ledger?riderId=` · `POST /admin/cash/deposit {riderId, warehouseId, amount}` · `POST /admin/cash/adjust` · `GET /admin/reconciliation` · `POST /admin/reconciliation/:id/resolve`.

## 7. Data
**cash_ledger**: `riderId`, `warehouseId`, `type` (`collected, deposit, adjustment`), `amount` signed (collected +, deposit −), `orderId?`, `flags?` (`overpaid, unmatched`), `balanceAfter`, `note?` (required for adjustments), `by`. Index `(riderId, at)`, `(warehouseId, at)`.
UPI-unverified collections are not ledger entries; they stay on `orders.collection` until verified (F13).

## 8. Settings
`cashInHandLimit` (off, optional) · `warehouses.upi` business VPA (audited, F03).

## 9. Permissions
Rider: `rider_cash:view`. Admin: `cash:manage` (deposit 🔒, adjustment 🔒, UPI reconciliation 🔒).

## 10. Open questions
1. Cash-in-hand limit that blocks new assignments?
2. If a rider carries cash from two warehouses, where is it handed over and who signs?
3. Bank reconciliation routine for doorstep UPI.
