# API · F12 Coupons & Offers

Spec: [F12](../customer/12-coupons-and-offers.md) · Conventions: [00](00-conventions.md)

Applying a coupon to a cart is `POST /cart/coupon` in [F10](F10-cart-and-quote.md). Home banners for customers are read with `GET /banners` in [F08](F08-discovery-and-location.md). This file covers the coupon list for customers and the admin editors.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/coupons/available` | Customer | Coupons the customer can use now |
| `GET` | `/admin/coupons` | Admin `pricing:manage` | List coupons |
| `POST` | `/admin/coupons` | Admin `pricing:manage` | Create a coupon |
| `GET` | `/admin/coupons/:id` | Admin `pricing:manage` | One coupon |
| `PUT` | `/admin/coupons/:id` | Admin `pricing:manage` | Edit a coupon |
| `POST` | `/admin/coupons/:id/deactivate` | Admin `pricing:manage` | Stop a coupon 🔒 |
| `GET` | `/admin/coupons/:id/usage` | Admin `pricing:manage` | Redemptions of a coupon |
| `GET` | `/admin/banners` | Admin `pricing:manage` | List banners |
| `POST` | `/admin/banners` | Admin `pricing:manage` | Create a banner |
| `PUT` | `/admin/banners/:id` | Admin `pricing:manage` | Edit a banner |
| `DELETE` | `/admin/banners/:id` | Admin `pricing:manage` | Delete a banner (and its image) |

## GET /coupons/available
Query: `zoneId`, `subtotal` (paise, optional). 200:
```json
{
  "data": [
    { "code": "WELCOME50", "type": "flat", "description": "₹50 off your first order", "value": 5000, "minOrder": 20000, "applicable": true, "reason": null },
    { "code": "FREEDEL", "type": "free_delivery", "description": "Free delivery", "value": 0, "minOrder": 30000, "applicable": false, "reason": "min_order" }
  ],
  "meta": { "count": 2 }
}
```
`applicable: false` coupons are shown greyed with the `reason` (`min_order`, `first_order_only`, `limit_reached`, `expired`, `not_applicable`).

## Object: coupon

```json
{
  "id": "coupon_1",
  "code": "WELCOME50",
  "type": "flat",
  "value": 5000,
  "maxDiscount": null,
  "minOrder": 20000,
  "perUserLimit": 1,
  "totalLimit": 500,
  "usedCount": 37,
  "firstOrderOnly": true,
  "zoneIds": ["zone_1"],
  "warehouseIds": [],
  "startsAt": "2026-11-01T00:00:00Z",
  "endsAt": "2026-12-01T00:00:00Z",
  "isActive": true
}
```
`type`: `percent` (`value` = percent, capped by `maxDiscount`), `flat` (paise), `free_delivery`. One coupon per order. `code` is unique and upper-case.

## POST /admin/coupons · PUT /admin/coupons/:id
Body: the object above without `id` and `usedCount`. 201/200: the coupon. Errors: `409 CONFLICT` (code exists) · `400 VALIDATION_ERROR` (percent above 100, end before start).

## POST /admin/coupons/:id/deactivate
200: the coupon with `isActive: false`. In-flight quotes that already applied it stay valid until they expire.

## GET /admin/coupons/:id/usage
Query: `limit`, `cursor`. 200:
```json
{
  "data": [{ "userId": "user_1", "customerName": "Asha Rai", "orderGroupId": "grp_1", "groupNo": "DS-240001", "discountAmount": 5000, "at": "2026-11-05T10:31:00Z" }],
  "meta": { "nextCursor": null, "totalDiscount": 185000 }
}
```

## Banners

```json
{ "id": "ban_1", "title": "Free delivery above ₹399", "imageMediaId": "media_20", "link": { "type": "category", "id": "cat_1" }, "zoneId": null, "sortOrder": 1, "startsAt": null, "endsAt": null, "isActive": true }
```
- `POST /admin/banners` body: the object without `id` (upload the image first with [F24](F24-media-storage.md)). `zoneId: null` means all zones. `link.type`: `category`, `product`, `url`.
- `PUT /admin/banners/:id`: any field.
- `DELETE /admin/banners/:id`: also deletes the image from S3.

## Product and category offers
There is no separate offer endpoint. A sale is a `salePrice` with `saleStart`/`saleEnd` on a warehouse offering ([F05](F05-warehouse-stock-and-pricing.md)); customers see it as a lower `price` with `onSale: true`.

## Implementation notes (backend, pricing module)

- **Validation errors are `400 VALIDATION_ERROR`**, not 422. Codes are 3 to 20 letters, digits, `-` or `_`, stored in capitals. `description` is optional; without one it reads "₹50 off", "10% off up to ₹15" or "Free delivery".
- **Customer list** marks each coupon `applicable` or greyed with `min_order`, `first_order_only`, `limit_reached` or `not_applicable`. Coupons that are off or past their end are not listed. A customer who has used up their own limit sees `limit_reached`.
- **Limits are atomic.** `pricing.service.hold(userId, couponId, groupId, discount)` takes one use for an order in a database transaction: the total limit and the per-customer limit can never be passed, even by simultaneous orders, and a repeat for the same order group takes nothing. `release(groupId)` gives it back (a cancelled order) and is safe to repeat. `check(userId, code, ...)` is used by the cart and quote and throws `COUPON_INVALID` (`422`) with the reason.
- **Deactivating** stops new use only; an order that already holds the coupon keeps it.
- **Usage** lists newest first with `totalDiscount`; `customerName` is filled when the identity module's names are connected (`customerNames` option), otherwise `null`.
- **Banners.** The image is a `banner` upload ([F24](F24-media-storage.md)) attached on save; replacing it deletes the old one, and so does deleting the banner. `link.type: url` must be HTTPS. Customers see a zone's banners through `GET /banners` ([F08](F08-discovery-and-location.md)): active, in date, for that zone or all zones, ordered by `sortOrder`.
- **First-order coupons** need the order count of a customer: pass `orderHistory` to `createDev2Modules`; until orders exist every customer counts as new.
