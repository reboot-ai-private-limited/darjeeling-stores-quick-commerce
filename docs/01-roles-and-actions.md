# 01 – Roles & Action Catalog

Status: draft v1 · Depends on: `PLAN.md`

## 1. RBAC principles

- **One role per user** (`users.roleId`). Roles are rows in the `roles` collection, not code.
- Every protected API route is guarded by `requirePermission('<key>')`. Routes never check role names.
- **Permission key format:** `module:action` (e.g. `orders:assign`). The full list is registered in code and seeded to the DB on startup so the admin UI always shows every key.
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

## 5. Admin actions (all held by `admin` at launch; each key can be given to future roles)

🔒 = writes `audit_log`.

### 5.1 Dashboard & reports
| Key | Action |
|---|---|
| `dashboard:view` | Today's orders, revenue, active riders, pending refunds, low stock |
| `reports:sales` | Sales by day/product/category, export CSV |
| `reports:orders` | Order funnel, cancellations, failed deliveries |
| `reports:cash` | COD cash by rider/day |
| `reports:riders` | Deliveries, shift hours per rider |
| `reports:stock` | Stock movement, wastage |
| `reports:export` | Export any report to CSV |

### 5.2 Orders
| Key | Action | Notes |
|---|---|---|
| `orders:list` / `orders:view` | List, filter, search, view order + timeline | |
| `orders:confirm` | Confirm (if manual confirm enabled) | |
| `orders:pack_start` / `orders:pack_complete` | Mark packing / ready | |
| `orders:mark_item_unavailable` 🔒 | Mark line unavailable; bill recalculated; refund auto-created as `requested` if prepaid | |
| `orders:edit_items` 🔒 | Adjust items before dispatch | Recalculates bill |
| `orders:cancel` 🔒 | Cancel with reason; stock restored; refund created if paid | |
| `orders:assign` 🔒 | Manually assign rider | |
| `orders:reassign` 🔒 | Reassign to another rider | |
| `orders:force_status` 🔒 | Override state (exceptions) | Reason required |
| `orders:mark_cod_collected` 🔒 | Fix COD collection if rider app failed | |
| `orders:resolve_failed_delivery` 🔒 | Re-dispatch, cancel, or return to stock | |
| `orders:add_note` | Internal note on order | |
| `orders:print_invoice` | Print/download invoice and packing slip | |
| `orders:create_manual` 🔒 | Create order on behalf of customer (phone orders) | Optional |

### 5.3 Dispatch
| Key | Action |
|---|---|
| `dispatch:board_view` | Live board: unassigned, assigned, out for delivery, riders online |
| `dispatch:view_rider_map` | Map of rider positions |
| `dispatch:alerts_view` | Unaccepted-offer and delayed-order alerts |

### 5.4 Catalog
| Key | Action |
|---|---|
| `category:list/create/update/reorder` | Manage category tree |
| `category:delete` 🔒 | Delete / archive category |
| `category:toggle` | Activate/deactivate |
| `product:list/view/create/update` | Manage products |
| `product:delete` 🔒 | Archive product |
| `product:toggle` | Activate/deactivate or mark out of stock |
| `variant:create/update/delete` | Manage variants (label, weightGrams, price, mrp, sku) |
| `product_image:upload/delete/reorder` | Cloudinary images |
| `product:bulk_import` / `product:bulk_export` 🔒 | CSV import/export |
| `product_tag:manage` | Tags, featured, sections for home |

### 5.5 Inventory
| Key | Action | Notes |
|---|---|---|
| `stock:view` | Stock levels, low-stock list | |
| `stock:adjust` 🔒 | Add/remove stock with reason (purchase, wastage, correction) | Writes `stock_movements` |
| `stock:count` 🔒 | Stock-take: set counted qty, record difference | |
| `stock:history` | Movement history per product | |

### 5.6 Pricing & offers
| Key | Action |
|---|---|
| `price:update` 🔒 | Change price/MRP (single/bulk); writes `price_history` |
| `price:schedule_sale` 🔒 | Sale price with date range |
| `coupon:list/create/update` | Manage coupons |
| `coupon:deactivate` 🔒 | Disable coupon |
| `coupon:view_usage` | Redemptions per coupon/user |
| `banner:manage` | Home banners, promo content |

### 5.7 Customers
| Key | Action |
|---|---|
| `customers:list/view` | Search, profile, order history, addresses |
| `customers:block` / `customers:unblock` 🔒 | Block abusive/fraud users (e.g. COD abuse) |
| `customers:cod_toggle` 🔒 | Allow/deny COD per customer |
| `customers:delete_finalise` 🔒 | Finalise account deletion/anonymisation |
| `customers:export` 🔒 | Export customer data |
| `customers:add_note` | Internal notes |

### 5.8 Riders & cash
| Key | Action |
|---|---|
| `riders:list/view` | Rider list, status, today's orders |
| `riders:create/update` 🔒 | Onboard rider (phone, name, photo, documents) |
| `riders:deactivate` / `riders:reactivate` 🔒 | Suspend/restore access; revokes tokens |
| `riders:shifts_view` | Attendance and shift log |
| `riders:force_offline` 🔒 | Force a rider offline |
| `cash:ledger_view` | Cash collected vs deposited per rider |
| `cash:record_deposit` 🔒 | Record cash handed in by rider (end of day) |
| `cash:adjust` 🔒 | Correct a ledger entry with reason |

### 5.9 Payments & refunds
| Key | Action | Notes |
|---|---|---|
| `payments:list/view` | Payments with Razorpay ids, status | |
| `payments:reconcile` | Run/view Razorpay reconciliation, flag mismatches | |
| `payments:mark_paid_manual` 🔒 | Resolve stuck payment after checking dashboard | |
| `refunds:list` | Pending / done refunds | |
| `refunds:view` | Detail, reason, photos | |
| `refunds:approve` 🔒 | Approve customer-requested refund (or `refunds:reject` with reason) | |
| `refunds:reject` 🔒 | Reject with reason | |
| `refunds:create` 🔒 | Create refund (cancellation, unavailable item, manual) | |
| `refunds:mark_done` 🔒 | After paying outside the system: method, reference, note → notify customer | |

### 5.10 Zones & store
| Key | Action |
|---|---|
| `zones:list/view` | See zones |
| `zones:create/update` 🔒 | Draw/edit polygon, per-zone fee, min order, hours |
| `zones:toggle` 🔒 | Enable/disable zone |
| `store:pause_orders` 🔒 | Quick "pause orders" switch (also in settings) |

### 5.11 Notifications
| Key | Action |
|---|---|
| `notifications:templates_view/update` 🔒 | Edit push/WhatsApp template mapping and text |
| `notifications:send_broadcast` 🔒 | Promo push to segment |
| `notifications:log_view` | Delivery log, failures |
| `notifications:retry` | Retry failed message |

### 5.12 Settings
| Key | Action |
|---|---|
| `settings:view` | View all settings |
| `settings:update_store` 🔒 | Store info, hours, pause |
| `settings:update_delivery` 🔒 | Fee mode, thresholds, min order, ETA |
| `settings:update_assignment` 🔒 | Assignment mode, offer timeout, max orders per rider |
| `settings:update_payments` 🔒 | COD enable/cap, expiry minutes, refund window/rules |
| `settings:update_stock` 🔒 | Low-stock threshold, max qty, reservation timeout |
| `settings:update_auth` 🔒 | OTP rules, delivery-OTP on/off |
| `settings:update_app` 🔒 | Min app version, download link, support number |
| `settings:update_tax` 🔒 | GST rates, inclusive/exclusive |
| `settings:history` | See change history |

### 5.13 Users, roles & security (`admin` has view only; edits are `super_admin`)
| Key | Action |
|---|---|
| `staff:list/view` | See staff accounts |
| `staff:create/update/deactivate` 🔒 | Manage staff accounts |
| `staff:reset_password` 🔒 | Reset password / 2FA |
| `roles:list/view` | See roles and their permissions |
| `roles:create/update/delete` 🔒 | Build roles by ticking permission keys (super_admin only at launch) |
| `audit:view` | Audit log search |
| `sessions:revoke` 🔒 | Force logout a user |

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
| Staff & roles edit | – | – | – | view | ✔ |
| Audit log | – | – | – | ✔ | ✔ |

## 8. Open points

1. Does a customer need to confirm the order manually before packing (`orders:confirm`), or is it automatic after payment/COD placement? (Default: automatic.)
2. Cancel cutoff: customer can cancel until which state? (Default: before `PACKING`; setting.)
3. Phone-created orders (`orders:create_manual`): needed at launch?
4. Rider documents (licence, ID) stored in Cloudinary private assets: required at onboarding?
