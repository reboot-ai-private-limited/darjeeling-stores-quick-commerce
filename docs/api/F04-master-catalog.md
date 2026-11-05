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
  "images": [{ "mediaId": "media_1", "alt": "Tomatoes", "sortOrder": 0, "urls": { "320": "https://cdn.example.com/…/320.webp" } }],
  "variants": [
    { "id": "var_1", "label": "250 g", "weightGrams": 250, "sku": "TOM-250", "barcode": null, "isActive": true },
    { "id": "var_2", "label": "500 g", "weightGrams": 500, "sku": "TOM-500", "barcode": null, "isActive": true }
  ],
  "gstRate": 0, "hsnCode": "0702",
  "status": "active", "sortOrder": 1
}
```
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
  "variants": [
    { "label": "250 g", "weightGrams": 250, "sku": "TOM-250" },
    { "label": "500 g", "weightGrams": 500, "sku": "TOM-500" }
  ],
  "gstRate": 0,
  "hsnCode": "0702",
  "status": "inactive"
}
```
201: the product (images empty until attached). Errors: `409 CONFLICT` (SKU or slug exists; `details.field`) · `400 VALIDATION_ERROR`. A new product is not sellable until a warehouse adds it ([F05](F05-warehouse-stock-and-pricing.md)).

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
