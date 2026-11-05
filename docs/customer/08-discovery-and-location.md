# F08 – Discovery & Location

Status: draft v3 · Folder: customer · Depends on: F03, F05 · See also: F07 (Notify Me), F09 (addresses), F10 (cart), F21 (offline cache and delta sync)

## 1. Purpose
Find the customer's zone, then show the zone's catalog, prices, fees and ETA fast, even on weak hill networks.

## 2. Flow

1. App asks for location permission. Allowed → GPS. Denied → the customer picks city and locality by hand (each locality has a centre point).
2. `POST /location/resolve {lat,lng | localityId}` → `$geoIntersects` against enabled zones → `zoneId`.
3. **No zone:** "Coming soon to your area" and a waitlist signup.
4. **Zone found:** the app loads the **zone catalog**: the union of products offered by the zone's warehouses (open or not), deduplicated by product. Each product shows one price (guaranteed by the same-price rule, F05) and is *available* if at least one **open** warehouse in the zone has stock.
5. Header ETA range = best open warehouse in the zone (F20).
6. Zone with no open warehouse → closed view or pre-order view (F17).
7. **No zone, no prices:** browsing is blocked until a zone is known.
8. Saved addresses carry their own `zoneId`. Choosing an address in a different zone switches the catalog (F10 zone-change rule).

## 3. Home, search and categories

- **Home:** delivery ETA header with location, search bar, rain/late-night fee notice when active (F11), promo banners (F12), category shortcuts, product sections, sticky cart bar, bottom navigation.
- **Category view:** left category menu with a 2-column product grid.
- **Search:** debounced instant results over the zone catalog (Mongo text index; Atlas Search later).
- **Product cards:** WebP image, pack size, MRP vs selling price, ADD button that becomes a − / + stepper.
- **Out of stock:** card shows **Notify me** (F07).
- **Store state:** open/closed, paused, pre-order windows (F17).

## 4. UX rules (the "10-second order")

| Rule | Detail |
|---|---|
| Optimistic cart | + / − update the count instantly with a light haptic, no blocking spinner (F10) |
| Smooth lists | `@shopify/flash-list`, `expo-image` with disk cache, WebP card images ≤ 30 KB |
| Skeletons only | Shimmer skeletons, never full-screen spinners |
| Local cache | Catalog cached in MMKV; home opens from cache in under a second (F21) |
| Sticky cart bar | Persistent bar "X items | ₹Y → View cart" |

## 5. Delta sync (summary, full design in F21)
Every offering has a `rev`. `GET /catalog/changes?zoneId=&since=<rev>` returns only changed resolved product entries (price, stock flag, status, new products) plus the new `rev`. Archived items arrive as tombstones.

## 6. Screens (customer)
Location permission / locality picker · "Coming soon" with waitlist · Home · Category view · Search · Product detail (pack sizes, details, Add) · Closed / pre-order notice.

## 7. API
Full request and response reference with examples: [API · F08](../api/F08-discovery-and-location.md).

`POST /location/resolve` · `GET /catalog/home?zoneId=` · `GET /catalog/categories?zoneId=` · `GET /catalog/products?zoneId=&categoryId=` · `GET /catalog/products/:id?zoneId=` · `GET /catalog/search?zoneId=&q=` · `GET /catalog/changes?zoneId=&since=` · `GET /store/status?zoneId=` · `GET /banners?zoneId=` · `POST /waitlist`.

## 8. Data
**waitlist**: `userId?`, `phone`, `location`, `localityId?`, `createdAt`.
Reads: `warehouse_products` (F05), `products`/`categories` (F04), `banners` (F12), `zones`/`localities` (F03).

## 9. Settings
`showOutOfStockItems` · `maxQtyPerItem` · banner list (F12).

## 10. Permissions
`location:resolve_zone` (guest), `catalog:browse` (guest), `catalog:search` (guest), `catalog:changes` (guest), `store:view_status` (guest), `banner:view` (guest), `zone:check` (guest).

## 11. Open questions
1. Show products from a closed warehouse as "available at 7 AM"? Default: shown as unavailable unless pre-order is on.
