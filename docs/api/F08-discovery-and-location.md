# API · F08 Discovery & Location

Spec: [F08](../customer/08-discovery-and-location.md) · Conventions: [00](00-conventions.md)

Location → zone resolution is in [F03](F03-zones-and-warehouses.md) (`POST /location/resolve`). Every call here takes the `zoneId` that resolve returned. **No zone, no prices:** the apps must not call catalog endpoints until a zone is known.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/catalog/home` | Public | Home screen payload for a zone |
| `GET` | `/catalog/categories` | Public | Category tree for a zone |
| `GET` | `/catalog/products` | Public | Products of a category (zone catalog) |
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
    { "variantId": "var_1", "label": "250 g", "weightGrams": 250, "price": 1800, "mrp": 2000, "onSale": false, "available": true, "maxQty": 10 },
    { "variantId": "var_2", "label": "500 g", "weightGrams": 500, "price": 3000, "mrp": 4000, "onSale": true, "available": true, "maxQty": 10 }
  ],
  "available": true,
  "availability": "in_stock",
  "rev": 18234
}
```
`availability`: `in_stock`, `out_of_stock` (show **Notify me**, [F07](F07-notify-me.md)), or `closed` (every warehouse in the zone is closed now). Use the 320 image for cards.

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
Save `rev` as the starting delta-sync cursor.

## GET /catalog/categories
Query: `zoneId`. 200: `{ "data": [{ "id": "cat_1", "name": "Vegetables", "imageUrl": "…", "children": [{ "id": "cat_2", "name": "Leafy Greens" }] }] }`. Only categories with at least one sellable product in the zone.

## GET /catalog/products
Query: `zoneId`, `categoryId`, `limit` (default 40), `cursor`, `inStockOnly=true`. 200: `{ "data": [<zone product>], "meta": { "nextCursor": "c_2" } }`.

## GET /catalog/products/:id
Query: `zoneId`. 200: `{ "data": { …zone product…, "description": "Grown on Darjeeling hill farms.", "shelfLife": "5 days" } }`. `404 NOT_FOUND` when the product is not sold in this zone.

## GET /catalog/search
Query: `zoneId`, `q` (≥ 2 characters), `limit` (default 20). Debounce on the client (~250 ms). 200: `{ "data": [<zone product>], "meta": { "count": 3 } }`.

## GET /catalog/changes
Query: `zoneId`, `since` (the last `rev` you stored). Returns only what changed (price, availability, new, archived products) so the home screen opens fast on a weak network.

200:
```json
{
  "data": [
    { "id": "prod_1", "variants": [{ "variantId": "var_2", "price": 3200, "mrp": 4000, "onSale": false, "available": true, "maxQty": 10 }], "available": true, "availability": "in_stock", "rev": 18240 },
    { "id": "prod_7", "deleted": true, "rev": 18241 }
  ],
  "meta": { "cursor": 18241, "fullResync": false }
}
```
- `deleted: true` is a tombstone (archived or no longer sold): remove it from the cache.
- `fullResync: true` means your cursor is too old: drop the cache and reload with `/catalog/home` and the category endpoints.
- Store `meta.cursor` as the next `since`.

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
`accepting` is false when closed or paused: browsing still works, checkout is blocked with `pauseMessage` or the reopening time. `preOrderAvailable` means checkout can book a next-morning slot ([F17](F17-hours-preorders-and-ops-mode.md)).

## GET /banners
Query: `zoneId`. 200: `{ "data": [{ "id": "ban_1", "title": "…", "image": { "mediaId": "…", "urls": { "640": "…" } }, "link": { "type": "category", "id": "cat_1" } }] }`. `link.type`: `category`, `product`, `url`.

## POST /waitlist
Body: `{ "phone": "+919876543210", "location": { "lat": 27.2, "lng": 88.4 }, "localityId": null }`. 201: `{ "data": { "ok": true } }`. Logged-in users do not need to send `phone`.
