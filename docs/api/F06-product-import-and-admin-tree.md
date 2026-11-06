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
Edit a row by calling `PUT /admin/warehouse-products/:offeringId` with its `rev`. Scoped staff only see their warehouses (`403 FORBIDDEN` for any other).

- `q` matches product name or SKU. `status` is `active`, `inactive` or `archived`. `lowStock=true` keeps products whose stock is below the low-stock threshold.
- Categories are nested through `children[]`, ordered by `sortOrder` then name. A category with no matching product anywhere below it is left out. Products are ordered by name.
- Per-variant (packaged) products have `stockGrams: null` and the unit count in each `variants[].stock`.
- One call returns the whole warehouse (up to 5,000 offerings); beyond that the call answers `400 VALIDATION_ERROR` and the admin must narrow it with `q` or `status`.

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
- `quantityMode`: `copy` (default), `zero`, `fixed` (then `fixedQuantity` is required: grams for a pooled product, units for every size of a per-variant product).
- `onConflict`: `skip` (default) or `overwrite`.
- `markupPercent`: optional, from -90 to 500, default 0. It is applied to `price`, `mrp` and `salePrice` and rounded to whole paise.
- Send **exactly one** of `productIds` (up to 500), `categoryId` (that category and every sub-category) or `selectAll: true`; anything else is `400 VALIDATION_ERROR`. At most 500 products can be previewed at once. `categoryId` and `selectAll` skip archived offerings.
- Both warehouses must be inside the caller's scope.
- Only sizes that are active in the master product and in the source are copied. A sale that has already ended is not copied.

200: nothing is saved yet except the preview itself, which lasts one hour, can be used once, and belongs to the admin who made it.
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
`conflicts[]` appear when the target is in the **same zone** as another warehouse that has the product at a different price (`PRICE_CONFLICT`). Each item is `{ "variantId", "conflicts": [{ "warehouseId", "price" }] }`. Importing into a warehouse of a different zone allows different prices.

Row details:
- `action`: `create`, `overwrite` or `skip`. A `skip` row has `variants: []` and no `stockGrams`. A row is skipped when the product is already in the target and `onConflict` is `skip`, or when it cannot be imported (see the warning codes).
- `stockGrams` is set for loose (pooled) products and `null` for per-variant products, whose quantity is in `variants[].stock`.
- Each variant also carries `saleStart`, `saleEnd` and `maxQtyPerOrder`, which are copied from the source with the sale price.
- Warning `code`s: `QUANTITY_COPIED` (copy mode) · `QUANTITY_SET` (zero or fixed mode with a non-zero quantity) · `STOCK_REPLACED` (overwrite will replace the target's prices and quantity) · `INVALID_PRICE` (for example a markup that breaks `salePrice < price <= mrp`; fix it before commit) · `PRODUCT_ARCHIVED` · `PRODUCT_NOT_IN_CATALOG` · `NO_ACTIVE_VARIANTS` (the last three make the row `skip`).
- `summary.conflicts` counts rows that have at least one conflict.

Errors: `404 NOT_FOUND` (a warehouse, a category, or products the source does not sell; `details.productIds` lists them) · `400 VALIDATION_ERROR` (source equals target, bad selector or option) · `403 FORBIDDEN` (scope or permission).

## POST /admin/import/commit
Send the (possibly edited) rows back. Quantity rows must be confirmed. The preview rows can be sent back as they are: fields the server only displays (`name`, `alreadyInTarget`, `warnings`, `conflicts`, `label`) are ignored.

- A row's `action` must equal the preview's, or be `skip`. A product left out of `rows` is skipped.
- For a row that is not skipped, send the sizes to sell, each with `price` and `mrp` (and optionally `salePrice`, `saleStart`, `saleEnd`, `maxQtyPerOrder`, `stock`). A size left out of the row is not created. An omitted `salePrice`, `stock`, `stockGrams` or sale window keeps the preview's value.
- Prices follow the F05 rules (`price` > 0, `mrp` >= `price`, `salePrice` below `price`).
- The commit is all or nothing: one failed row saves nothing and the same preview can be sent again after the fix.
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
`skipped` is every previewed product that was not created or overwritten. Creates the offerings (or, for `overwrite`, replaces the prices, sale and quantity of the sizes sent) with `importedFrom`, writes `stock_movements` (reason `import`, the change in quantity) and `price_history`, an audit entry per offering, and bumps `rev` so customers get the change by delta sync. The source warehouse is not changed. If the import brings a product from sold out to available in the whole zone, the `stock.zone_availability_changed` event fires (Notify Me, [F07](F07-notify-me.md)).

Errors:
- `400 VALIDATION_ERROR` when `confirmQuantities` is not `true` and a row has a quantity above zero (`details.field = "confirmQuantities"`), and for any row that does not match the preview. This API uses `400` for every `VALIDATION_ERROR` ([conventions](00-conventions.md#4-error-codes)).
- `409 PRICE_CONFLICT` (block mode) with the F05 `details` shape for the first conflict (`variantId`, `conflicts`, `canApplyToOthers: false`) plus `productId` and `variants[]`, which lists every conflicting size of every row. Edit the prices in the rows and resend with the same `previewId`.
- `409 CONFLICT` with `details.reason = "target_changed"` when the target warehouse gained or lost the product after the preview. Run the preview again.
- `410` is not used. An unknown, expired (after one hour), already-used or someone else's `previewId` returns `404 NOT_FOUND`.
- `403 FORBIDDEN` for a missing permission or a warehouse outside the caller's scope.

## Implementation notes (backend, D2-5)

- Both endpoints live in the offerings module. The preview is stored in `import_previews` and removed by MongoDB when it expires; a commit deletes it inside its own transaction, so two commits of one preview cannot both succeed.
- A commit locks each zone and product like any other price write, so the same-zone price rule holds even while other admins edit prices.
- Creating a product's offering in the target starts it `active`. Overwriting keeps the target's `status`, out-of-stock switch and any size not in the source.
- Images are not copied because they belong to the master product and are shared by reference.
- Importing from or into a warehouse outside a scoped admin's scope is refused, so a scoped admin cannot import between two warehouses unless both are in their scope.
