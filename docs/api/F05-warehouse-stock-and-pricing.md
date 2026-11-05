# API · F05 Warehouse Stock & Pricing

Spec: [F05](../catalog/05-warehouse-stock-and-pricing.md) · Conventions: [00](00-conventions.md)

A **warehouse offering** is one warehouse's price and stock for one master product. Customers buy from offerings; the zone catalog is the union of the zone's warehouses ([F08](F08-discovery-and-location.md)).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/warehouses/:id/products` | Admin `warehouse_catalog:view` | List a warehouse's offerings |
| `POST` | `/admin/warehouse-products` | Admin `warehouse_catalog:manage` | Add a master product to a warehouse |
| `GET` | `/admin/warehouse-products/:id` | Admin `warehouse_catalog:view` | One offering |
| `PUT` | `/admin/warehouse-products/:id` | Admin `warehouse_catalog:manage` | Edit price, quantity, on/off |
| `POST` | `/admin/warehouse-products/bulk` | Admin `warehouse_catalog:manage` | Bulk edit many offerings |
| `POST` | `/admin/stock/adjust` | Admin `stock:manage` | Add or remove stock with a reason |
| `POST` | `/admin/stock/count` | Admin `stock:manage` | Stock-take: set counted quantities |
| `GET` | `/admin/stock/levels` | Admin `stock:view` | Levels, low-stock list |
| `GET` | `/admin/stock/movements` | Admin `stock:view` | Stock movement history |
| `GET` | `/admin/price-history` | Admin `stock:view` | Price change history |

The tree view and import live in [F06](F06-product-import-and-admin-tree.md).

## Object: warehouse offering

```json
{
  "id": "wp_1",
  "warehouseId": "wh_1",
  "productId": "prod_1",
  "zoneId": "zone_1",
  "product": { "name": "Fresh Tomato (Local)", "type": "loose", "stockMode": "pooled_weight", "categoryId": "cat_1" },
  "status": "active",
  "stockGrams": 24000,
  "variants": [
    { "variantId": "var_1", "label": "250 g", "weightGrams": 250, "price": 1800, "mrp": 2000, "salePrice": null, "saleStart": null, "saleEnd": null, "stock": null, "maxQtyPerOrder": 10, "isActive": true },
    { "variantId": "var_2", "label": "500 g", "weightGrams": 500, "price": 3200, "mrp": 4000, "salePrice": 3000, "saleStart": "2026-11-05T00:00:00Z", "saleEnd": "2026-11-07T00:00:00Z", "stock": null, "maxQtyPerOrder": 10, "isActive": true }
  ],
  "isOutOfStockOverride": false,
  "rev": 18234,
  "importedFrom": null
}
```
Loose products use `stockGrams` (pooled); packaged products use `variants[].stock` (units). `rev` is the optimistic-lock counter: send it back on every edit.

## GET /admin/warehouses/:id/products
Query: `?q=&categoryId=&status=&lowStock=true&limit=50&cursor=`. 200: `{ "data": [<offering>], "meta": { "nextCursor": null } }`. Scoped staff get `403 FORBIDDEN` for warehouses outside their scope.

## POST /admin/warehouse-products
Body:
```json
{
  "warehouseId": "wh_1",
  "productId": "prod_1",
  "stockGrams": 24000,
  "variants": [
    { "variantId": "var_1", "price": 1800, "mrp": 2000 },
    { "variantId": "var_2", "price": 3200, "mrp": 4000, "maxQtyPerOrder": 10 }
  ]
}
```
201: the offering. Errors: `409 CONFLICT` (already in this warehouse) · `409 PRICE_CONFLICT` · `404 NOT_FOUND`.

## PUT /admin/warehouse-products/:id
Body (all optional except `rev`):
```json
{
  "rev": 18234,
  "status": "active",
  "stockGrams": 22000,
  "isOutOfStockOverride": false,
  "variants": [{ "variantId": "var_2", "price": 3300, "mrp": 4000, "salePrice": null }]
}
```
200: the updated offering with the new `rev`. Writes `price_history` / `stock_movements` and an audit entry.

Errors:
- `409 VERSION_CONFLICT`: `rev` is stale; reload.
- `409 PRICE_CONFLICT`: the same product has a different price in another warehouse of the same zone (when `zonePriceConflictMode` is `block`):
```json
{ "error": { "code": "PRICE_CONFLICT", "message": "Price differs from another warehouse in this zone", "details": { "variantId": "var_2", "conflicts": [{ "warehouseId": "wh_2", "price": 3200 }], "canApplyToOthers": true } } }
```
With `zonePriceConflictMode = warn` the save succeeds and the response adds `"warnings": [{ "code": "PRICE_CONFLICT", … }]`. To fix a conflict, resend with `"applyToWarehouseIds": ["wh_2"]`.

## POST /admin/warehouse-products/bulk
Body:
```json
{
  "ids": ["wp_1", "wp_2"],
  "action": { "type": "price_percent", "value": 5 }
}
```
`action.type`: `set_price` (paise), `price_percent`, `price_amount` (paise, may be negative), `set_quantity`, `add_quantity`, `set_status`. For quantity actions, `value` is grams (pooled) or units. 200:
```json
{ "data": { "updated": 2, "failed": [{ "id": "wp_2", "code": "PRICE_CONFLICT" }] } }
```
Failures do not stop the rest.

## POST /admin/stock/adjust
Body:
```json
{ "warehouseId": "wh_1", "productId": "prod_1", "variantId": null, "delta": 5000, "reason": "purchase", "note": "Morning delivery from farm" }
```
`delta` is signed (grams for pooled stock, units otherwise). `reason`: `purchase`, `wastage`, `correction`. 200:
```json
{ "data": { "movementId": "mv_1", "balanceAfter": 29000, "rev": 18235 } }
```
Errors: `409 INSUFFICIENT_STOCK` (would go below zero). If stock goes from 0 to above 0 anywhere in the zone, Notify Me messages are queued ([F07](F07-notify-me.md)).

## POST /admin/stock/count
Body: `{ "warehouseId": "wh_1", "counts": [{ "productId": "prod_1", "variantId": null, "counted": 21500 }] }`. 200: `{ "data": { "adjusted": [{ "productId": "prod_1", "before": 22000, "after": 21500, "delta": -500 }] } }`. Reason is recorded as `count`.

## GET /admin/stock/levels
Query: `?warehouseId=&lowStock=true&limit&cursor`. 200:
```json
{ "data": [{ "warehouseId": "wh_1", "productId": "prod_1", "name": "Fresh Tomato (Local)", "unit": "grams", "stock": 21500, "lowStockThreshold": 5000, "isLow": false }], "meta": { "nextCursor": null } }
```

## GET /admin/stock/movements
Query: `?warehouseId=&productId=&reason=&from=&to=&limit&cursor`. 200:
```json
{ "data": [{ "id": "mv_1", "warehouseId": "wh_1", "productId": "prod_1", "variantId": null, "mode": "grams", "delta": -1000, "balanceAfter": 21500, "reason": "order", "orderId": "ord_1", "note": null, "by": null, "createdAt": "2026-11-05T10:31:00Z" }], "meta": { "nextCursor": null } }
```
`reason`: `order`, `cancel`, `return`, `purchase`, `correction`, `wastage`, `count`, `import`. `by` is null for system actions.

## GET /admin/price-history
Query: `?warehouseId=&productId=&variantId=&from=&to=`. 200 items: `{ "warehouseId", "productId", "variantId", "oldPrice", "newPrice", "oldMrp", "newMrp", "by", "at" }`.
