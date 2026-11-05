# F04 – Master Catalog

Status: draft v3 · Folder: catalog · Depends on: F02, F24 · See also: F05 (price and stock per warehouse), F06 (import), F08 (browse)

## 1. Purpose
One global list of what we sell: categories, products, variants (pack sizes), images, tax data. It holds **no price and no stock**; those live per warehouse (F05).

## 2. What we sell
Groceries, vegetables, fruits, dairy, staples, household. Loose items are sold as **fixed-size variants** (250 g / 500 g / 1 kg) so the bill is exact at checkout and never changes with a weighing step. Packaged items are sold by unit with variants (for example 500 g / 1 kg pack).

## 3. Flows

**Add a product (admin):** choose category → name, description, type (`loose`/`packaged`), stock mode → add variants (label, weight in grams, SKU) → upload images (F24) → GST rate and HSN code → save as `inactive` or `active`. A new product is not sellable until a warehouse adds it (F05/F06).

**Edit / archive:** edits apply everywhere. Products that were ever ordered are **archived**, never deleted, and keep their images. Never-ordered products can be permanently deleted, which deletes their images from S3 (F24).

**Duplicate check:** admin warns when a new product name or SKU looks like an existing one (prevents the same item existing twice with different prices).

**CSV import/export (phase 3):** bulk create and update the master catalog 🔒.

## 4. Rules

| Rule | Detail |
|---|---|
| Stock modes | `pooled_weight` (loose: one gram pool per warehouse; each variant deducts `weightGrams × qty`) and `per_variant` (packaged: units per variant) |
| SKU | Unique per variant |
| Images | Stored in S3 as WebP sizes (F24); removing or replacing an image deletes it from S3 |
| Tax | `gstRate` (percent), `hsnCode`; confirm rates with a CA |
| Status | `active`, `inactive`, `archived` |
| Compliance | FSSAI licence number kept in store settings (F25) |

## 5. Screens (admin)
Category tree (create, reorder, toggle) · product list with search and filters · product editor (details, variants, images, tax) · duplicate warning.

## 6. API
Full request and response reference with examples: [API · F04](../api/F04-master-catalog.md).

Admin: `GET/POST/PUT /admin/categories` · `GET/POST/PUT/DELETE /admin/products` · `POST /admin/products/:id/images` · `DELETE /admin/products/:id/images/:mediaId`. Customer reads go through the zone catalog (F08).

## 7. Data

**categories**: `name`, `slug` (unique), `parentId?`, `imageMediaId?`, `sortOrder`, `isActive`. Index `parentId + sortOrder`.

**products** (master, no price, no stock)

| Field | Type | Notes |
|---|---|---|
| vendorId | ref | Defaults to owner |
| name, slug (unique), description | | |
| categoryId | ref | |
| tags, images[{mediaId, alt, sortOrder}] | | |
| type | enum | `loose`, `packaged` |
| stockMode | enum | `pooled_weight`, `per_variant` |
| variants | embedded[] | `{_id, label, weightGrams, sku (unique), barcode?, isActive}` |
| gstRate, hsnCode | | |
| status | enum | `active, inactive, archived` |
| sortOrder | int | |

Indexes: `slug` unique, `categoryId+status`, `variants.sku` unique sparse, text on `name`/`tags`.

## 8. Settings
`maxQtyPerItem` (global) · FSSAI/GST numbers (store group).

## 9. Permissions
`catalog:view`, `catalog:manage` (category delete 🔒, product archive 🔒, image removal 🔒, CSV 🔒).

## 10. Open questions
1. Product expiry and batch tracking for perishables (phase 3).
2. Barcode scanning at packing (phase 3).
