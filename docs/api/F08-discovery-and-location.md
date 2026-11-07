# API · F08 Discovery & Location

Spec: [F08](../customer/08-discovery-and-location.md) · Conventions: [00](00-conventions.md)

Location → zone resolution is in [F03](F03-zones-and-warehouses.md) (`POST /location/resolve`). Every call here takes the `zoneId` that resolve returned. **No zone, no prices:** the apps must not call catalog endpoints until a zone is known.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/catalog/home` | Public | Home screen payload for a zone |
| `GET` | `/catalog/categories` | Public | Category tree for a zone |
| `GET` | `/catalog/products` | Public | Products of a category, brand or food type (zone catalog) |
| `GET` | `/catalog/brands` | Public | Brands that have something to sell in the zone |
| `GET` | `/catalog/products/:id` | Public | One product with all sizes |
| `GET` | `/catalog/search` | Public | Instant search |
| `GET` | `/catalog/changes` | Public | Delta sync since a revision |
| `GET` | `/store/status` | Public | Open/closed, paused, fees and ETA notices |
| `GET` | `/banners` | Public | Home banners |
| `POST` | `/waitlist` | Public | Join the "coming soon" waitlist |

## Object: zone product

Prices are what the customer pays: **`price` already has any sale price applied**. One price per product (the same-price rule, [F05](F05-warehouse-stock-and-pricing.md)); the app never sees warehouse names.

```json
{
  "id": "prod_1",
  "name": "Fresh Tomato (Local)",
  "slug": "fresh-tomato-local",
  "categoryId": "cat_1",
  "type": "loose",
  "tags": ["fresh", "local"],
  "images": [{ "mediaId": "media_1", "alt": "Tomatoes", "urls": { "160": "…/160.webp", "320": "…/320.webp", "640": "…/640.webp", "1080": "…/1080.webp" } }],
  "variants": [
    { "variantId": "var_1", "label": "250 g", "weightGrams": 250, "price": 1800, "mrp": 2000, "discountAmount": 200, "discountPercent": 10, "onSale": false, "saleEndsAt": null, "available": true, "maxQty": 10 },
    { "variantId": "var_2", "label": "500 g", "weightGrams": 500, "price": 3000, "mrp": 4000, "discountAmount": 1000, "discountPercent": 25, "onSale": true, "saleEndsAt": "2026-11-07T00:00:00Z", "available": true, "maxQty": 10 }
  ],
  "available": true,
  "availability": "in_stock",
  "rev": 18234
}
```
Money is in paise. `discountAmount` is `mrp - price` (0 or more) and `discountPercent` is the whole-number percentage of `mrp` (0 to 100), both worked out by the server so every app shows the same number. Show a discount badge only when `discountPercent` is above 0. `saleEndsAt` is the end of the active sale (or null) for a "ends soon" label; the server never sends a sale price that has already ended. Stock quantities are never sent to customers, only `available` and `availability`.

`availability`: `in_stock`, `out_of_stock` (show **Notify me**, [F07](F07-notify-me.md)), or `closed` (every warehouse in the zone is closed now). Use the 320 image for cards. Each image carries all four sizes in `urls` (160, 320, 640, 1080).

A zone product merges the zone's warehouses: a size is `available` when any warehouse that is open now has at least one pack, the price is the one customers pay (the lowest, from a warehouse that can deliver it), `maxQty` is the lowest per-order limit of those warehouses (and the store-wide `maxQtyPerItem` if set), and `rev` is the newest change to anything that sells it here. Stock numbers, warehouse ids and warehouse names are never sent. Products are listed in shelf order: the product's `sortOrder`, then its name.

**Every call below needs `zoneId`** (24 characters): missing or malformed is `400 VALIDATION_ERROR`, a zone that does not exist or is switched off is `404 NOT_FOUND`. None of them needs a login.

## GET /catalog/home
Query: `zoneId` (required). 200:
```json
{
  "data": {
    "zone": { "id": "zone_1", "name": "Mall Road & Chowrasta" },
    "status": { "accepting": true, "etaMinMinutes": 15, "etaMaxMinutes": 20 },
    "notices": [{ "type": "rain", "label": "Rain mode: +₹15 delivery fee, +10 min" }],
    "banners": [{ "id": "ban_1", "title": "Free delivery above ₹399", "image": { "mediaId": "media_20", "urls": { "640": "…" } }, "link": { "type": "category", "id": "cat_1" } }],
    "categories": [{ "id": "cat_1", "name": "Vegetables", "imageUrl": "…/320.webp" }],
    "sections": [{ "title": "Fresh vegetables", "categoryId": "cat_1", "products": [ <zone product> ] }],
    "rev": 18234
  }
}
```
Save `rev` as the starting delta-sync cursor. It is read before the catalog, so any change made after it has a higher revision and arrives through `/catalog/changes`.

`status.accepting` is false when the zone is paused or every warehouse is closed. `categories` are the top-level categories that have something to sell, each with its 320 picture (`imageUrl`, or `null`). `sections` holds up to six top-level categories with up to ten products each (including sub-categories), in shelf order, skipping any with nothing to show. `banners` are explained under `GET /banners`.

## GET /catalog/categories
Query: `zoneId`. 200: `{ "data": [{ "id": "cat_1", "name": "Vegetables", "imageUrl": "…", "children": [{ "id": "cat_2", "name": "Leafy Greens" }] }] }`. Only categories with at least one sellable product in the zone somewhere beneath them, and only active categories whose parents are active. Children are nested to any depth and carry `id`, `name`, `imageUrl` and their own `children`. Ordered by `sortOrder`, then name.

## GET /catalog/products
Query: `zoneId`, `categoryId`, `limit` (default 40, at most 100), `cursor`, `inStockOnly=true`. 200: `{ "data": [<zone product>], "meta": { "nextCursor": "c_2" } }`. Without `categoryId` it lists the whole zone catalog. A `categoryId` includes every category beneath it; an unknown or switched-off category is `404`. `nextCursor` is opaque and `null` on the last page; a cursor that does not belong to this list is `400`. Sold-out products are listed (with Notify me) unless the store chose `showOutOfStockItems: false`; `inStockOnly=true` always hides them.

## GET /catalog/products/:id
Query: `zoneId`. 200: `{ "data": { …zone product…, "description": "…", "highlights": […], "keyInfo": […], "nutrition": {…} | null, "infoSections": […] } }`. These five fields come from the master product ([F04](F04-master-catalog.md#product-information-fields-all-optional-shown-on-the-customer-product-screen)) and are sent only here, not in lists or search. Always present: empty list or `null` when nothing is set. Example:
```json
{ "data": { "id": "prod_1", "name": "Fresh Tomato (Local)", "description": "Grown on Darjeeling hill farms.",
  "highlights": ["Grown on Darjeeling hill farms"],
  "keyInfo": [{ "label": "Shelf life", "value": "5 days" }, { "label": "Storage", "value": "Keep in a cool, dry place" }],
  "nutrition": { "basis": "per_100g", "servingSize": null, "rows": [{ "name": "Energy", "amount": 18, "unit": "kcal", "dailyValuePercent": null }] },
  "infoSections": [{ "title": "How to store", "body": "Refrigerate after cutting." }] } }
```
 `404 NOT_FOUND` when the product is not sold in this zone: unknown, in another zone, switched off at every warehouse of the zone, inactive or archived.

## GET /catalog/search
Query: `zoneId`, `q` (≥ 2 characters, at most 100), `limit` (default 20, at most 50). Debounce on the client (~250 ms). 200: `{ "data": [<zone product>], "meta": { "count": 3 } }`. Matches the product name (ignoring case, spaces and punctuation), its tags, or its SKU, over the products this zone sells. Names that start with the text come first, then names that contain it, then tags, then SKUs; ties go by name. Results are full zone products, without the detail fields.

## GET /catalog/changes
Query: `zoneId`, `since` (the last `rev` you stored). Returns only what changed (price, availability, new, archived products) so the home screen opens fast on a weak network.

200:
```json
{
  "data": [
    { "id": "prod_1", "variants": [{ "variantId": "var_2", "price": 3200, "mrp": 4000, "discountAmount": 800, "discountPercent": 20, "onSale": false, "saleEndsAt": null, "available": true, "maxQty": 10 }], "available": true, "availability": "in_stock", "rev": 18240 },
    { "id": "prod_7", "deleted": true, "rev": 18241 }
  ],
  "meta": { "cursor": 18241, "fullResync": false }
}
```
- `deleted: true` is a tombstone (archived or no longer sold): remove it from the cache.
- `fullResync: true` means your cursor is too old: drop the cache and reload with `/catalog/home` and the category endpoints.
- Store `meta.cursor` as the next `since`.
- Each entry is the **full current zone product** (the example above is trimmed), so a product the app has never seen can be added from it. Entries are ordered by revision, oldest first, and a product that changed at several warehouses appears once.
- A product is a tombstone (`deleted: true`) when the zone no longer sells it: archived, made inactive, switched off at every warehouse, or its master record is gone. Edits to the master product (name, tags, images, sizes) also arrive here.
- With nothing new, `data` is empty and `cursor` is the current revision (never lower than `since`).
- `fullResync: true` (with an empty `data` and `cursor` set to the current revision) when more than 500 products changed since `since`, or `since` is ahead of the server (for example a restored database). Reload from `/catalog/home`.
- `since` is a whole number from 0; anything else is `400`.

## GET /store/status
Query: `zoneId`. 200:
```json
{
  "data": {
    "zoneId": "zone_1",
    "accepting": true,
    "open": true,
    "paused": false,
    "pauseMessage": null,
    "opensAt": null,
    "closesAt": "2026-11-05T14:30:00Z",
    "afterHoursMode": "pre_order",
    "preOrderAvailable": true,
    "eta": { "minMinutes": 15, "maxMinutes": 20 },
    "minOrder": 10000,
    "freeDeliveryAbove": 60000,
    "smallOrderFee": 0,
    "notices": [
      { "type": "rain", "label": "Rain mode: +₹15 delivery fee, +10 min", "amount": 1500, "extraMinutes": 10 },
      { "type": "late_night", "label": "Late-night fee ₹20", "amount": 2000, "extraMinutes": 5 }
    ]
  }
}
```
`accepting` is false when the zone is paused or every warehouse of the zone is closed (`open` is whether any warehouse is open now): browsing still works, checkout is blocked with `pauseMessage` or the reopening time. `pauseMessage` is `null` unless paused. `preOrderAvailable` means checkout can book a next-morning slot ([F17](F17-hours-preorders-and-ops-mode.md)).

## GET /banners
Query: `zoneId`. 200: `{ "data": [{ "id": "ban_1", "title": "…", "image": { "mediaId": "…", "urls": { "640": "…" } }, "link": { "type": "category", "id": "cat_1" } }] }`. `link.type`: `category`, `product`, `url` (a `url` link has `url` instead of `id`), or `link` is `null`. `image` is `null` when a banner has no picture; its `urls` carry all four sizes.

## POST /waitlist
Body: `{ "phone": "+919876543210", "location": { "lat": 27.2, "lng": 88.4 }, "localityId": null }`. 201: `{ "data": { "ok": true } }`. Logged-in users do not need to send `phone`: their own number is used. Send a `location` or a `localityId` (at least one); an unknown `localityId` is `404`, a missing phone for a guest is `400`. Phones are accepted as `+919876543210`, `9876543210` or with spaces and dashes. There is one entry per phone and area (the locality, or a patch of about a kilometre around the point), so sending the same thing again changes nothing and still answers `201`.

## Implementation notes (backend, D2-6)

- **Reads from others.** The zone catalog is built from the master catalog (F04), the warehouses' offerings and revisions (F05) and media sizes (F24). Nothing about it is stored separately.
- **Geography is Dev 1's.** Zones, localities and warehouse opening hours (F03, F17) are read through `Geography` in `apps/api/src/platform/geography.ts` (`zone`, `zoneAt`, `warehousesOfZone` with `isOpenNow`, `locality`). Dev 1 implements it and passes it as `geography` to the Dev 2 composition; until then there are no zones, so every call here answers `404`. `POST /location/resolve` and `POST /zones/check` are F03 and not part of this module.
- **Stand-ins for Dev 1's settings.** Hours, fees and the ETA (F11, F17, F20) come from `storeSettings` and banners (F12) from `banners`. Until they exist the ETA is 15 to 20 minutes, there are no fees, notices or pre-orders, and no banners. Whether the store is open still comes from the warehouses.
- **Revisions.** Every offering has a `rev` taken from one counter inside the same transaction as the change, so revisions are handed out in commit order and a client that has seen revision N has seen every change up to N. Changes to the master product (rename, images, sizes, archive) bump the `rev` of its offerings too.
- **Settings** (module options for now): `showOutOfStockItems` (true), `maxQtyPerItem` (none), and the 500-product limit before a full reload.
- **Known shortcuts.** Each catalog call reads the zone's offerings and products once and works in memory, which is fine for a few thousand products; add a short cache when catalogs grow. Search is a simple contains match on names, tags and SKUs, not a text index. Lists are ordered by shelf position and name with an opaque cursor, so a product added mid-way can shift later pages by one.

## Brand, food type, badge and categories on products
Every product card and the detail view now also carry `brand: { id, name } | null`, `foodType`, `badge`, `isReturnable`, `categoryIds` (the main category first, then the extra ones) and, on each variant, `attributes` ([F04](F04-master-catalog.md)). `GET /catalog/products` accepts `brandId` and `foodType` (`veg`, `non_veg`, `egg`, `vegan`) next to `categoryId`; a product listed under extra categories appears in each of them. `GET /catalog/brands?zoneId=` returns `[{ id, name, slug, logoUrl, productCount }]` for brands that sell something in the zone, for a brand page. Search also matches the brand name.
