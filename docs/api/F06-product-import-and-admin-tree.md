# API · F06 Product Import & Admin Product Tree

Spec: [F06](../catalog/06-product-import-and-admin-tree.md) · Conventions: [00](00-conventions.md)

Inline and bulk edits reuse [F05](F05-warehouse-stock-and-pricing.md) (`PUT /admin/warehouse-products/:id`, `POST /admin/warehouse-products/bulk`).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/warehouses/:id/tree` | Admin `warehouse_catalog:view` | Category → product → variants tree for one warehouse |
| `POST` | `/admin/import/preview` | Admin `catalog:import` | Preview copying products from another warehouse |
| `POST` | `/admin/import/commit` | Admin `catalog:import` | Create the offerings from an edited preview |

## GET /admin/warehouses/:id/tree
Query: `?q=&status=&lowStock=true`. 200:
```json
{
  "data": {
    "warehouseId": "wh_1",
    "categories": [
      {
        "id": "cat_1", "name": "Vegetables",
        "products": [
          {
            "offeringId": "wp_1", "productId": "prod_1", "name": "Fresh Tomato (Local)",
            "status": "active", "rev": 18234, "stockGrams": 24000,
            "variants": [
              { "variantId": "var_1", "label": "250 g", "price": 1800, "mrp": 2000, "salePrice": null, "stock": null, "isActive": true },
              { "variantId": "var_2", "label": "500 g", "price": 3200, "mrp": 4000, "salePrice": null, "stock": null, "isActive": true }
            ]
          }
        ],
        "children": []
      }
    ]
  }
}
```
Edit a row by calling `PUT /admin/warehouse-products/:offeringId` with its `rev`. Scoped staff only see their warehouses.

## POST /admin/import/preview
Body:
```json
{
  "sourceWarehouseId": "wh_1",
  "targetWarehouseId": "wh_2",
  "productIds": ["prod_1", "prod_2"],
  "categoryId": null,
  "selectAll": false,
  "options": { "quantityMode": "copy", "onConflict": "skip", "markupPercent": 0 }
}
```
- `quantityMode`: `copy` (default), `zero`, `fixed` (then send `fixedQuantity`).
- `onConflict`: `skip` (default) or `overwrite`.
- `markupPercent`: optional bulk price markup.
- Use `productIds`, or `categoryId`, or `selectAll: true`.

200: nothing is saved yet.
```json
{
  "data": {
    "previewId": "prev_1",
    "rows": [
      {
        "productId": "prod_1", "name": "Fresh Tomato (Local)", "alreadyInTarget": false, "action": "create",
        "stockGrams": 24000,
        "variants": [{ "variantId": "var_2", "label": "500 g", "price": 3200, "mrp": 4000, "salePrice": null, "stock": null }],
        "warnings": [{ "code": "QUANTITY_COPIED", "message": "Quantity is copied from the source. Set it to this warehouse's real stock." }],
        "conflicts": []
      },
      {
        "productId": "prod_2", "name": "Darjeeling Carrot", "alreadyInTarget": true, "action": "skip",
        "variants": [], "warnings": [], "conflicts": []
      }
    ],
    "summary": { "create": 1, "overwrite": 0, "skip": 1, "conflicts": 0 }
  }
}
```
`conflicts[]` appear when the target is in the **same zone** as another warehouse that has the product at a different price (`PRICE_CONFLICT`). Importing into a warehouse of a different zone allows different prices.

Errors: `404 NOT_FOUND` (warehouse or product) · `400 VALIDATION_ERROR` (source equals target) · `403 FORBIDDEN` (scope).

## POST /admin/import/commit
Send the (possibly edited) rows back. Quantity rows must be confirmed.
```json
{
  "previewId": "prev_1",
  "confirmQuantities": true,
  "rows": [
    {
      "productId": "prod_1",
      "action": "create",
      "stockGrams": 5000,
      "variants": [{ "variantId": "var_2", "price": 3300, "mrp": 4000, "salePrice": null }]
    }
  ]
}
```
201:
```json
{ "data": { "created": 1, "overwritten": 0, "skipped": 1, "offeringIds": ["wp_9"] } }
```
Creates the offerings with `importedFrom`, writes `stock_movements` (reason `import`) and `price_history`, and bumps `rev` so customers get the change by delta sync. The source warehouse is not changed.

Errors:
- `422 VALIDATION_ERROR` when `confirmQuantities` is not `true` and a row has a quantity.
- `409 PRICE_CONFLICT` (block mode) with the same `details` shape as in F05. Edit the price in the preview and resend.
- `410` is not used; an old `previewId` returns `404 NOT_FOUND`.
