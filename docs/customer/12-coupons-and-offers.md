# F12 – Coupons & Offers

Status: draft v3 · Folder: customer · Depends on: F10, F11 · See also: F25 (banners in admin), F08 (home banners)

## 1. Purpose
Let the owner run discounts and promotions: coupon codes, a first-order offer, free-delivery coupons, product or category offers, and home banners.

## 2. Flow

1. Admin creates a coupon (type, value, limits, validity, optional zones/warehouses).
2. Customer opens the coupon box in the cart, picks or types a code → `POST /cart/coupon` → the server validates it.
3. The quote applies the discount first, before delivery fee calculation (F11 §5).
4. At order placement a `coupon_redemptions` row is written and `usedCount` is incremented atomically.
5. If the order is cancelled before dispatch, the redemption is released (F16).

## 3. Rules

| Rule | Detail |
|---|---|
| Types | `percent`, `flat`, `free_delivery` |
| Limits | `minOrder`, `maxDiscount` (cap for percent), `perUserLimit`, `totalLimit`, `firstOrderOnly` |
| Validity | `startsAt`, `endsAt`, `isActive` |
| Scope | Optional `zoneIds` / `warehouseIds` |
| Server validation | The client never decides if a coupon is valid |
| Stacking | One coupon per order (no stacking at launch) |
| Free-delivery coupon | Sets the delivery fee to 0; surcharges still apply unless `waivedByFreeDelivery` |
| Product/category offers | Sale price on an offering (F05) with dates; shown as a discounted price, not a coupon |
| Banners | Image, link (category/product/deeplink), optional zone, schedule, sort order |

## 4. Screens
- **Customer:** coupon row and coupon list in cart, banners on home.
- **Admin:** coupon list and editor with usage counts, banner manager, offers on the product tree.

## 5. API
Full request and response reference with examples: [API · F12](../api/F12-coupons-and-offers.md).

`POST /cart/coupon {code}` · `DELETE /cart/coupon` · `GET /coupons/available` · admin: `GET/POST/PUT /admin/coupons` · `GET/POST/PUT /admin/banners`.

## 6. Data

**coupons**: `code` (unique, upper-case), `type`, `value`, `maxDiscount?`, `minOrder`, `perUserLimit`, `totalLimit?`, `usedCount`, `firstOrderOnly`, `zoneIds?`, `warehouseIds?`, `startsAt`, `endsAt`, `isActive`.
**coupon_redemptions**: `couponId`, `userId`, `orderGroupId`, `discountAmount`, `at`. Unique `(couponId, orderGroupId)`; index `(couponId, userId)`.
**banners**: `title`, `imageMediaId`, `link`, `zoneId?` (null = all), `sortOrder`, `startsAt?`, `endsAt?`, `isActive`.

## 7. Settings
`firstOrderOfferEnabled` and value · coupon stacking off.

## 8. Permissions
Customer: `coupon:apply`, `coupon:remove`, `banner:view`. Admin: `pricing:manage` (coupons, banners, bulk price 🔒, scheduled sale 🔒).

## 9. Open questions
1. Wallet or store credit for refunds? Not in v1 (refunds are manual, F16).
2. Stacking a coupon with a sale price? Default allowed because sale price is part of the item price.
