# 01 – Roles & Action Catalog

Status: draft v1 · Depends on: `PLAN.md`

## 1. RBAC principles

- **One role per user** (`users.roleId`). Roles are rows in the `roles` collection, not code.
- Every protected API route is guarded by `requirePermission('<key>')`. Routes never check role names.
- **Permission key format:** `module:view` / `module:manage` for admin (e.g. `orders:manage`); fixed `module:action` keys for customer and rider. The full list is registered in code and seeded to the DB on startup so the admin UI always shows every key.
- **System roles** (`isSystem: true`, cannot be deleted): `super_admin` (`*`), `customer`, `rider`.
- **Launch staff role:** one `admin` role holding all admin permissions. New roles later (Packer, Dispatcher, Support, Manager…) = new rows with a subset of keys, created in the admin panel – no deploy.
- **Scope:** customer and rider actions are always limited to the user's **own** data (`scope: own`); admin actions are store-wide.
- The JWT carries `userId` + `roleId`; permissions are read from an in-memory cache that refreshes when a role is edited.
- Admin UI hides what the user can't do, but the API check is the enforcement.
- Sensitive actions write to `audit_log` (marked 🔒 below).

## 2. Roles

| Role | Who | Login | Notes |
|---|---|---|---|
| `guest` | Not logged in | none | Browse only; must log in to add address, checkout |
| `customer` | App/web buyer | phone + OTP | Own data only |
| `rider` | Salaried delivery partner (6) | phone + OTP, pre-registered by admin | Own assignments only |
| `admin` | Store staff (launch) | email + password (+2FA optional) | All admin permissions; split into roles later |
| `super_admin` | Owner / developer | email + password + 2FA | `*`; manages roles & users; cannot be edited by `admin` |

## 3. Customer & guest actions

Customer keys are fixed (not editable in the role UI). `G` = also allowed for guest.

### 3.1 Auth & profile
| Key | Action | Notes |
|---|---|---|
| `auth:request_otp` (G) | Request OTP for phone | Rate-limited per phone/IP |
| `auth:verify_otp` (G) | Verify OTP → login | Creates user on first login |
| `auth:refresh` | Refresh access token | |
| `auth:logout` | Logout (revoke refresh token) | |
| `profile:view` | View own profile | |
| `profile:update` | Edit name, email | Phone change needs OTP re-verify |
| `profile:delete_request` | Request account deletion | Anonymise per policy; admin finalises |
| `address:list` / `address:create` / `address:update` / `address:delete` | Manage saved addresses | Pin must fall inside a zone to be marked deliverable |
| `address:set_default` | Set default address | |
| `device:register_token` | Register/refresh FCM token | |
| `notification_pref:update` | Toggle push/WhatsApp promos | Transactional always on |

### 3.2 Browse
| Key | Action | Notes |
|---|---|---|
| `catalog:browse` (G) | Home, categories, product list, product detail | Only active, in-zone-available products |
| `catalog:search` (G) | Search products | |
| `store:view_status` (G) | See open/closed, delivery fee info, min order | From settings |
| `zone:check` (G) | Check if a location is deliverable | |
| `banner:view` (G) | See home banners | |

### 3.3 Cart & checkout
| Key | Action | Notes |
|---|---|---|
| `cart:view` | View cart (server-priced) | |
| `cart:add_item` | Add variant | Respects stock and max qty per item |
| `cart:update_qty` | + / − quantity | |
| `cart:change_variant` | Switch size (250 g ↔ 500 g ↔ 1 kg) | |
| `cart:remove_item` / `cart:clear` | Remove / empty | |
| `coupon:apply` / `coupon:remove` | Apply/remove coupon | Validated server-side |
| `checkout:preview` | Get bill breakdown | Subtotal, discount, delivery fee, taxes, total |
| `order:place_cod` | Place COD order | Subject to COD cap/zone settings |
| `order:place_online` | Place online order → Razorpay | Order pending until paid |
| `payment:verify` | Submit Razorpay result for verification | Webhook is source of truth |
| `payment:retry` | Retry failed online payment | Before expiry |

### 3.4 Orders & tracking
| Key | Action | Notes |
|---|---|---|
| `order:list_own` / `order:view_own` | Order history and detail | |
| `order:track` | Poll tracking (status, rider position, ETA) | |
| `order:cancel_own` | Cancel order | Only until the cancel cutoff state (setting) |
| `order:reorder` | Re-add a past order's items to cart | |
| `order:share_delivery_otp` | See delivery OTP in order screen | If delivery-OTP is on |
| `rider:call` | Call/see assigned rider name | |
| `refund:request` | Request refund (cancelled/missing/damaged item) | Within refund window (setting); photo if required |
| `refund:view_own` | See refund status | |
| `support:contact` | Open support contact (call/WhatsApp) | From settings |
| `feedback:rate_order` | Rate order / delivery | Optional, phase 2 |

## 4. Rider actions (`rider` role, own data only)

| Key | Action | Notes |
|---|---|---|
| `rider_shift:start` / `rider_shift:end` | Go online / offline | Logs attendance; blocked with open cash/orders per settings |
| `rider_shift:break` | Pause for break | Not offered new orders |
| `rider_offer:list` | See incoming offers | |
| `rider_offer:accept` / `rider_offer:reject` | Accept/reject within timeout | Timeout → next rider |
| `rider_order:list` | See own assigned orders | |
| `rider_order:view` | Order detail: items, address, payment mode, amount to collect | |
| `rider_order:navigate` | Open Google Maps navigation | |
| `rider_order:pickup` | Mark picked up from store | → `PICKED_UP` |
| `rider_order:start_delivery` | Mark out for delivery | → `OUT_FOR_DELIVERY`, starts fast polling |
| `rider_order:verify_delivery_otp` | Enter customer's OTP | If delivery-OTP on |
| `rider_order:collect_cash` | Confirm cash collected (COD amount) | Writes cash ledger entry |
| `rider_order:deliver` | Mark delivered | → `DELIVERED` |
| `rider_order:report_failed` | Report failed delivery with reason (customer unreachable, wrong address, refused) + photo | → `FAILED_DELIVERY`, alerts admin |
| `rider_location:update` | Send location (~10 s) | Only with active order |
| `rider_cash:view` | See own cash in hand and ledger | |
| `rider_history:view` | Own delivery history, counts | |
| `rider_profile:view` / `rider_profile:update_photo` | Own profile | |
| `device:register_token` | Register FCM token | |
| `auth:*` | Login/logout as above | Invite-only phone |

## 5. Admin actions

Admin permissions are **module-level** (about 24 keys): `:view` = read-only, `:manage` = everything in that module. `admin` holds all of them at launch; a future role (e.g. Packer) gets a subset, and a key can be split later if finer control is needed. 🔒 = also written to `audit_log` regardless of key.

| Key | Module | Actions covered |
|---|---|---|
| `dashboard:view` | Dashboard | Today's orders, revenue, active riders, pending refunds, low stock |
| `reports:view` | Reports | Sales (day/product/category), order funnel & cancellations, COD cash by rider/day, rider deliveries & shift hours, stock movement/wastage, CSV export |
| `orders:view` | Orders | List, filter, search, view order + timeline, internal notes, print invoice/packing slip |
| `orders:manage` | Orders | Confirm (if `orderConfirmMode = manual`), start/complete packing, mark item unavailable 🔒, edit items before dispatch 🔒, cancel with reason 🔒, force status 🔒, fix COD collection 🔒, resolve failed delivery (re-dispatch / cancel / return to stock) 🔒, add note |
| `dispatch:manage` | Dispatch | Live board (unassigned / assigned / out for delivery), rider map, delayed & unaccepted-offer alerts, assign 🔒, reassign 🔒 |
| `catalog:view` | Catalog | View categories, products, variants |
| `catalog:manage` | Catalog | Category tree (create/update/reorder/toggle, delete 🔒), products (create/update/toggle, archive 🔒), variants (label, weightGrams, price, MRP, SKU), Cloudinary images, tags/featured sections, CSV import/export 🔒 |
| `stock:view` | Inventory | Stock levels, low-stock list, movement history |
| `stock:manage` | Inventory | Adjust stock with reason (purchase / wastage / correction) 🔒, stock-take count 🔒 |
| `pricing:manage` | Pricing & offers | Change price/MRP single or bulk 🔒 (writes `price_history`), scheduled sale price 🔒, coupons (create/update, deactivate 🔒, view usage), home banners & promo content |
| `customers:view` | Customers | Search, profile, order history, addresses |
| `customers:manage` | Customers | Block/unblock 🔒, allow/deny COD per customer 🔒, finalise account deletion 🔒, export 🔒, internal notes |
| `riders:view` | Riders | List, status, today's orders, shift/attendance log |
| `riders:manage` | Riders | Onboard/edit (phone, name, photo) 🔒, deactivate/reactivate 🔒 (revokes tokens), force offline 🔒 |
| `cash:manage` | Rider cash | View ledger (collected vs deposited), record end-of-day deposit 🔒, adjust entry with reason 🔒 |
| `payments:view` | Payments | Payments with Razorpay ids/status, reconciliation results |
| `payments:manage` | Payments | Run reconciliation, mark stuck payment paid after checking Razorpay dashboard 🔒 |
| `refunds:manage` | Refunds | Pending/done lists, view detail & photos, create 🔒, approve 🔒, reject with reason 🔒, **mark done** (method, reference, note → notifies customer) 🔒 |
| `zones:manage` | Zones | View/draw/edit polygon, per-zone fee/min order/hours, enable/disable 🔒, pause orders switch 🔒 |
| `notifications:manage` | Notifications | Edit push/WhatsApp templates 🔒, send broadcast 🔒, delivery log, retry failed |
| `settings:view` | Settings | View all settings and change history |
| `settings:manage` | Settings | Edit all setting groups 🔒: store, delivery (fee mode), assignment, payments (COD cap, expiry, refund window), stock, auth, app, tax, `orderConfirmMode` |
| `staff:manage` | Staff | Create/update/deactivate staff accounts 🔒, reset password/2FA 🔒, force logout 🔒 |
| `roles:manage` | Roles | View, create, edit, delete roles by ticking keys 🔒 (`super_admin` only at launch) |
| `audit:view` | Audit | Search audit log |

## 6. System / background actions (no user, no permission)

| Job | Trigger | Does |
|---|---|---|
| Payment expiry | Every minute | Cancel unpaid online orders past expiry; restore stock |
| Offer sweeper | Every ~10 s | Expire unaccepted rider offers; offer next; alert admin if none |
| Auto-assign | Order → `READY` | Pick rider per assignment mode |
| Notification worker | Jobs queue | Send push/WhatsApp/SMS with retries |
| Razorpay webhook handler | `payment.captured/failed` | Confirm or fail order (idempotent) |
| Reconciliation | Daily | Compare Razorpay vs DB, flag mismatches |
| Low-stock alert | On stock change | Notify admin when under threshold |
| Store hours | Per settings | Auto open/close store |
| Rider offline sweep | Periodic | Mark riders offline with no location ping |
| OTP/session cleanup | TTL indexes | Expire OTPs and tokens |

## 7. Role → permission matrix (launch)

| Module | guest | customer | rider | admin | super_admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Browse / search / zone check | ✔ | ✔ | – | ✔ | ✔ |
| Auth & own profile | OTP only | ✔ | ✔ | ✔ | ✔ |
| Cart, checkout, own orders, refund request | – | ✔ | – | – | – |
| Rider shift, offers, delivery, cash | – | – | ✔ | – | – |
| Orders, dispatch, catalog, stock, pricing | – | – | – | ✔ | ✔ |
| Customers, riders, cash, payments, refunds | – | – | – | ✔ | ✔ |
| Zones, notifications, settings | – | – | – | ✔ | ✔ |
| Staff & roles edit | – | – | – | – | ✔ |
| Audit log | – | – | – | ✔ | ✔ |

## 8. Decisions

1. Order confirmation (auto / manual) is an admin setting `orderConfirmMode`.
2. Customer cancel cutoff: before `PACKING` (admin setting).
3. No phone-created orders at launch.
4. No rider documents at launch.
