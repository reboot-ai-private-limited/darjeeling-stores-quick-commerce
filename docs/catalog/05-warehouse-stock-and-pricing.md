# F05 – Warehouse Stock & Pricing

Status: draft v3 · Folder: catalog · Depends on: F03, F04 · See also: F06 (import and admin tree), F07 (Notify Me), F13 (allocation), F08 (delta sync)

## 1. Purpose
Everything a customer pays or can buy comes from a warehouse's own row for a product: price, MRP, sale price, quantity, on/off. This doc covers that row, the stock rules and the same-price rule.

## 2. Model
A **warehouse offering** (`warehouse_products`) links one warehouse to one master product (F04) and holds the commercial data. The customer's catalog is the **union of the offerings of all warehouses in the zone** (F08).

## 3. Rules

| Rule | Detail |
|---|---|
| Unique offering | One row per `(warehouseId, productId)` |
| Zone price rule | The same product in several warehouses of one zone must have the **same effective selling price** per variant. Setting `zonePriceConflictMode`: `block` (default, the save is rejected) or `warn` |
| Other zones | Prices in warehouses of other zones are independent |
| Atomic stock | Deduct with `updateOne({warehouseId, productId, stock: {$gte: need}}, {$inc: ...})` at order placement; restore on cancel, expiry or unavailable item |
| Pooled weight | Loose products keep one gram pool per warehouse; a variant deducts `weightGrams × qty` |
| Per variant | Packaged products keep units on each variant |
| One line, one warehouse | A line is never split between warehouses (F13) |
| Low stock | Below `lowStockThreshold` → admin alert; at 0 the item shows unavailable in that warehouse |
| Sale price | Optional with start and end dates |
| Max quantity | `maxQtyPerOrder` per variant and `maxQtyPerItem` global |
| Delta sync | Every change bumps `rev` (from `counters`) so apps fetch only what changed (F08, F21) |
| Concurrency | Admin edits use `rev` as an optimistic lock |

### Stock events

| Event | Stock effect (that warehouse) | Movement reason |
|---|---|---|
| Order placed (COD or online pending) | Deduct, atomic | `order` |
| Cancelled, expired, item unavailable | Restore | `cancel` |
| Failed delivery returned | Restore | `return` |
| Failed delivery spoiled | No restore | `wastage` |
| Admin adjustment | ± with reason | `purchase` / `correction` / `wastage` |
| Stock-take | Set to counted | `count` |
| Product imported with quantity | Set initial | `import` |

## 4. Flows

**Add a product to a warehouse:** pick the master product → set price, MRP, quantity per variant → save (runs the zone price check) → it appears in the zone catalog.

**Adjust stock:** admin enters a quantity change with a reason → `stock_movements` row, `balanceAfter` updated, `rev` bumped → if 0 → >0 anywhere in the zone, Notify Me fires (F07).

**Change a price:** single or bulk edit → price check → `price_history` row → `rev` bump.

**Stock-take:** counted quantities replace the stored value; differences are logged.

## 5. Screens (admin)
Warehouse product tree and import live in F06. Inventory views: stock levels, low-stock list, movement history, stock-take sheet.

## 6. API
Admin: `GET /admin/warehouses/:id/products` · `PUT /admin/warehouse-products/:id` · `POST /admin/warehouse-products/bulk` · `POST /admin/stock/adjust` · `POST /admin/stock/count` · `GET /admin/stock/movements`.

## 7. Data

**warehouse_products**

| Field | Type | Notes |
|---|---|---|
| warehouseId, productId | ref | Unique together |
| zoneId | ref | Denormalised for zone catalog queries |
| status | enum | `active, inactive, archived` (also the delta-sync tombstone) |
| stockGrams | int? | Pool when `pooled_weight` |
| variants | embedded[] | `{variantId, price, mrp, salePrice?, saleStart?, saleEnd?, stock? (units), maxQtyPerOrder?, isActive}` |
| isOutOfStockOverride | bool | Manual out-of-stock |
| rev | int | Delta-sync cursor |
| importedFrom | {warehouseId, at, by}? | Audit only, no ongoing link |

Indexes: unique `(warehouseId, productId)`, `(zoneId, rev)`, `(zoneId, productId)`, `(warehouseId, status)`.

**stock_movements**: `warehouseId`, `productId`, `variantId?`, `mode` (grams/units), `delta`, `balanceAfter`, `reason` (`order, cancel, return, purchase, correction, wastage, count, import`), `orderId?`, `note?`, `by?`. Index `(warehouseId, productId, createdAt)`.
**price_history**: `warehouseId`, `productId`, `variantId`, old/new price, old/new MRP, `by`, `at`.
**counters**: `_id` (`catalogRev`, `orderNo`), `value`, incremented atomically.

## 8. Settings
`zonePriceConflictMode` (`block`) · `lowStockThreshold` (5) · `maxQtyPerItem` (10) · `reservationTimeoutMinutes` (equals online expiry).

## 9. Permissions
`warehouse_catalog:view`, `warehouse_catalog:manage`, `stock:view`, `stock:manage` (adjust 🔒, stock-take 🔒), `pricing:manage` (bulk price 🔒, sale price 🔒).

## 10. Open questions
1. A 10 kg line cannot be filled by two warehouses holding 6 kg each; accepted limitation.
2. A daily physical-vs-system stock count routine and its owner.
