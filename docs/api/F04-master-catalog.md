# API · F04 Master Catalog

Spec: [F04](../catalog/04-master-catalog.md) · Conventions: [00](00-conventions.md)

The master catalog has **no price and no stock** (those are per warehouse, [F05](F05-warehouse-stock-and-pricing.md)). Customers read products through the zone catalog ([F08](F08-discovery-and-location.md)).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/categories` | Admin `catalog:view` | Category tree |
| `POST` | `/admin/categories` | Admin `catalog:manage` | Create a category |
| `PUT` | `/admin/categories/:id` | Admin `catalog:manage` | Edit, move or toggle a category |
| `DELETE` | `/admin/categories/:id` | Admin `catalog:manage` | Delete an empty category |
| `POST` | `/admin/categories/reorder` | Admin `catalog:manage` | Reorder siblings |
| `GET` | `/admin/brands` | Admin `catalog:view` | List brands |
| `POST` | `/admin/brands` | Admin `catalog:manage` | Create a brand |
| `PUT` | `/admin/brands/:id` | Admin `catalog:manage` | Edit a brand or switch it on or off |
| `DELETE` | `/admin/brands/:id` | Admin `catalog:manage` | Delete a brand no product uses |
| `GET` | `/admin/products` | Admin `catalog:view` | Search and filter products |
| `POST` | `/admin/products` | Admin `catalog:manage` | Create a product with variants |
| `GET` | `/admin/products/:id` | Admin `catalog:view` | One product |
| `PUT` | `/admin/products/:id` | Admin `catalog:manage` | Edit a product |
| `POST` | `/admin/products/:id/archive` | Admin `catalog:manage` | Archive (keeps history and images) |
| `POST` | `/admin/products/:id/restore` | Admin `catalog:manage` | Un-archive |
| `DELETE` | `/admin/products/:id` | Admin `catalog:manage` | Permanently delete a never-ordered product |
| `POST` | `/admin/products/:id/variants` | Admin `catalog:manage` | Add a variant |
| `PUT` | `/admin/products/:id/variants/:variantId` | Admin `catalog:manage` | Edit a variant |
| `DELETE` | `/admin/products/:id/variants/:variantId` | Admin `catalog:manage` | Deactivate a variant |
| `POST` | `/admin/products/:id/images` | Admin `catalog:manage` | Attach an uploaded image |
| `PUT` | `/admin/products/:id/images/order` | Admin `catalog:manage` | Reorder images |
| `DELETE` | `/admin/products/:id/images/:mediaId` | Admin `catalog:manage` | Remove an image (also deleted from S3) |
| `POST` | `/admin/products/check-duplicate` | Admin `catalog:view` | Warn about a similar name or SKU |
| `GET` | `/admin/catalog/export` | Admin `catalog:manage` | CSV export (phase 3) |

## Objects

```json
// Category
{ "id": "cat_1", "name": "Vegetables", "slug": "vegetables", "parentId": null, "imageMediaId": "media_9", "sortOrder": 1, "isActive": true, "children": [] }

// Product (master)
{
  "id": "prod_1", "vendorId": "vendor_1",
  "name": "Fresh Tomato (Local)", "slug": "fresh-tomato-local",
  "description": "Grown on Darjeeling hill farms.",
  "categoryId": "cat_1",
  "type": "loose", "stockMode": "pooled_weight",
  "tags": ["fresh", "local"],
  "highlights": ["Grown on Darjeeling hill farms", "No added colour or wax"],
  "keyInfo": [
    { "label": "Shelf life", "value": "5 days" },
    { "label": "Storage", "value": "Keep in a cool, dry place" },
    { "label": "Country of origin", "value": "India" }
  ],
  "nutrition": {
    "basis": "per_100g", "servingSize": null,
    "rows": [
      { "name": "Energy", "amount": 18, "unit": "kcal", "dailyValuePercent": null },
      { "name": "Carbohydrates", "amount": 3.9, "unit": "g", "dailyValuePercent": 1 },
      { "name": "Protein", "amount": 0.9, "unit": "g", "dailyValuePercent": null }
    ]
  },
  "infoSections": [{ "title": "How to store", "body": "Refrigerate after cutting." }],
  "images": [{ "mediaId": "media_1", "alt": "Tomatoes", "sortOrder": 0, "urls": { "320": "https://cdn.example.com/…/320.webp" } }],
  "variants": [
    { "id": "var_1", "label": "250 g", "weightGrams": 250, "sku": "TOM-250", "barcode": null, "isActive": true },
    { "id": "var_2", "label": "500 g", "weightGrams": 500, "sku": "TOM-500", "barcode": null, "isActive": true }
  ],
  "gstRate": 0, "hsnCode": "0702",
  "status": "active", "sortOrder": 1
}
```
### Product information fields (all optional, shown on the customer product screen)

| Field | Limits | Purpose |
|---|---|---|
| `description` | up to 2000 characters | Free-text paragraph |
| `highlights` | up to 6 items, each up to 120 characters | Short bullet points shown near the top |
| `keyInfo` | up to 15 rows; `label` up to 40, `value` up to 200 characters; labels must be unique | "Key information" table. Suggested labels: Shelf life, Storage, Country of origin, Ingredients, Manufacturer, FSSAI licence no., Veg / Non-veg |
| `nutrition` | `null` or an object with `basis` and up to 20 `rows` | Nutrition facts table |
| `nutrition.basis` | `per_100g`, `per_100ml` or `per_serving` | What the amounts refer to |
| `nutrition.servingSize` | up to 40 characters, only for `per_serving` | For example "1 piece (30 g)" |
| `nutrition.rows[]` | `name` up to 60 characters; `amount` a number ≥ 0; `unit` one of `g`, `mg`, `mcg`, `kcal`, `kJ`, `ml`; `dailyValuePercent` optional, 0 to 1000 | One nutrient per row |
| `infoSections` | up to 6 items; `title` up to 60, `body` up to 1000 characters | Extra titled notes, such as "How to store" or "Disclaimer" |

All of these are plain text: no HTML is accepted or rendered. Sending the field replaces the whole value (for example the full `keyInfo` list); omitting it leaves it unchanged; `null` or an empty list clears it. Empty values are stored as `[]` / `null`, so the apps never receive a missing field. Changing any of them changes the product's `rev`, so delta sync refreshes the customer apps. Customer lists and search do not include these fields; only the product detail endpoint does ([F08](F08-discovery-and-location.md)).

`type`: `loose` or `packaged`. `stockMode`: `pooled_weight` (loose, one gram pool per warehouse) or `per_variant`. `status`: `active`, `inactive`, `archived`.

## Categories

- `GET /admin/categories` → `{ "data": [ <Category with children[]> ] }` (nested tree).
- `POST` body: `{ "name": "Vegetables", "parentId": null, "imageMediaId": "media_9", "sortOrder": 1 }` → 201 category. `409 CONFLICT` for a duplicate slug.
- `PUT` body (all optional): `name`, `parentId`, `imageMediaId`, `sortOrder`, `isActive`.
- `POST /admin/categories/reorder` body: `{ "parentId": null, "orderedIds": ["cat_2", "cat_1", "cat_3"] }` → `{ "data": { "ok": true } }`.
- `DELETE` → `409 CONFLICT` when it still has products or sub-categories. Audited.

## GET /admin/products
Query: `?q=tomato&categoryId=cat_1&status=active&type=loose&limit=50&cursor=`. 200: `{ "data": [<Product>], "meta": { "nextCursor": null } }`.

## POST /admin/products
Body:
```json
{
  "name": "Fresh Tomato (Local)",
  "description": "Grown on Darjeeling hill farms.",
  "categoryId": "cat_1",
  "type": "loose",
  "stockMode": "pooled_weight",
  "tags": ["fresh"],
  "highlights": ["Grown on Darjeeling hill farms"],
  "keyInfo": [{ "label": "Shelf life", "value": "5 days" }],
  "nutrition": { "basis": "per_100g", "servingSize": null, "rows": [{ "name": "Energy", "amount": 18, "unit": "kcal", "dailyValuePercent": null }] },
  "infoSections": [],
  "variants": [
    { "label": "250 g", "weightGrams": 250, "sku": "TOM-250" },
    { "label": "500 g", "weightGrams": 500, "sku": "TOM-500" }
  ],
  "gstRate": 0,
  "hsnCode": "0702",
  "status": "inactive"
}
```
201: the product (images empty until attached). Errors: `409 CONFLICT` (SKU or slug exists; `details.field`) · `400 VALIDATION_ERROR` (including a limit above exceeded, a repeated `keyInfo` label, or a repeated nutrient name; `details.field` names the field). A new product is not sellable until a warehouse adds it ([F05](F05-warehouse-stock-and-pricing.md)).

## PUT /admin/products/:id
Same fields as create, all optional; `variants` are changed through the variant endpoints. 200: the product.

## POST /admin/products/:id/archive · restore
No body. 200: the product with the new `status`. Archived products disappear from customer catalogs but stay on past orders.

## DELETE /admin/products/:id
200: `{ "data": { "ok": true } }`. Errors: `409 CONFLICT` if the product was ever ordered (archive it instead). Deletes all its images from S3.

## Variants
- `POST /admin/products/:id/variants` body `{ "label": "1 kg", "weightGrams": 1000, "sku": "TOM-1000", "barcode": "890…" }` → 201 variant.
- `PUT …/variants/:variantId` body: any of `label`, `weightGrams`, `sku`, `barcode`, `isActive`.
- `DELETE …/variants/:variantId` → deactivates (sets `isActive: false`); past orders keep their snapshot.

## Images
- `POST /admin/products/:id/images` body `{ "mediaId": "media_1", "alt": "Tomatoes" }`. First upload the file with [F24](F24-media-storage.md) (`/media/upload-url` then `/media/complete`) to get `mediaId`. 201: the image object.
- `PUT …/images/order` body `{ "orderedMediaIds": ["media_2", "media_1"] }`.
- `DELETE …/images/:mediaId` → 200 `{ "data": { "ok": true } }`; every size is deleted from S3 by a background job.

## POST /admin/products/check-duplicate
Body: `{ "name": "Fresh Tomato", "skus": ["TOM-500"] }` → 200:
```json
{ "data": { "similar": [{ "id": "prod_1", "name": "Fresh Tomato (Local)", "reason": "similar_name" }] } }
```
`reason`: `similar_name` or `sku_exists`. Use it to warn before creating.

## GET /admin/catalog/export
Phase 3. Returns `text/csv` of the master catalog. 🔒 audited.

## Implementation notes (backend, D2-4)

- `DELETE /admin/products/:id` is conservative: it is refused with `409 CONFLICT` while any warehouse offers the product, and also whenever the orders module has not confirmed the product was never ordered. Use archive instead.
- A product's `type` / `stockMode` and a variant's `weightGrams` cannot change once any warehouse offers the product (`409`, `details.reason = "has_offerings"`).
- Every product change bumps the `rev` of its offerings so apps pick up the change in delta sync.
- Image attach/remove depends on the media module (D2-3); until it exists, images cannot be attached in the real composition.
- Slugs support Latin letters and digits only.

## Brand, food type, extra categories, badge, returnable flag and variant attributes
All optional, so existing products keep working. A product that does not have them reads back with the defaults shown.

| Field | Values | Default | Notes |
|---|---|---|---|
| `brandId` | a brand id or `null` | `null` | The brand must exist and be switched on. The product view also returns `brand: { id, name }`. |
| `foodType` | `veg`, `non_veg`, `egg`, `vegan`, `not_applicable` | `not_applicable` | The mark customers see on food, and the "Pure veg" filter. Use `not_applicable` for non-food. |
| `extraCategoryIds` | up to 5 category ids | `[]` | The product also shows under these. They must exist, be distinct, and not repeat `categoryId`. Moving the main category to one of them removes it from this list. |
| `badge` | `bestseller`, `trending`, `new_launch`, `imported`, `organic` or `null` | `null` | The pill on the product card, chosen by staff. |
| `isReturnable` | boolean | `true` | `false` for eggs, cut vegetables, personal care. A non-returnable item is still refunded when it arrived damaged or missing, but not for a change of mind ([F16](F16-cancellations-and-refunds.md)). |
| variant `attributes` | up to 5 `{ name, value }` | `[]` | How a variant differs beyond weight, for example `{ "name": "Flavour", "value": "Chocolate" }`. A name cannot repeat within one variant. `weightGrams` stays required. |

`GET /admin/products` also takes `brandId` and `foodType`, and `categoryId` matches the main or an extra category. A category that is only used as an extra category still counts as having products, so it cannot be deleted.

### Brands
`POST /admin/brands` body `{ "name": "Amul", "logoMediaId": null, "sortOrder": 0 }` (upload the logo first with kind `brand_logo`). `PUT` takes any of `name`, `logoMediaId`, `sortOrder`, `isActive`. Names are unique. `DELETE` returns `409 CONFLICT` while products use the brand; switch it off instead. Each brand returns `{ id, name, slug, logoMediaId, logoUrls, sortOrder, isActive }`. The catalog export CSV gains the columns `brandId`, `foodType`, `badge`, `returnable`, `extraCategories` and `attributes`.
