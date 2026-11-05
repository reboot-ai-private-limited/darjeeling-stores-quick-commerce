# 01 – Roles & Action Catalog

Status: draft v2 · Depends on: `PLAN.md`

## 1. RBAC principles

- **One role per user** (`users.roleId`). Roles are rows in `roles`, not code. (A rider who also wants to shop uses another phone number for now – see `PLAN.md` open question 4.)
- Every protected route is guarded by `requirePermission('<key>')`; routes never check role names.
- **Key format:** `module:view` / `module:manage` for admin; fixed `module:action` for customer and rider. The full list is registered in code and seeded to the DB at startup.
- **System roles** (`isSystem`): `super_admin` (`*`), `customer`, `rider`. Launch staff role: one `admin` with all admin keys. Later roles (Packer, Dispatcher, Warehouse Manager, Support) are new rows with subsets – no deploy.
- **Data scope (new):**
  - Customer/rider: **own data only**.
  - Rider: only orders assigned to them, in their zone.
  - Staff: `users.scope = { all: true }` or `{ warehouseIds: [...] }`. Every admin query is filtered by scope on the server (warehouse-scoped users cannot see other warehouses' orders, stock, riders' cash). `super_admin` and the owner's `admin` get `all`.
  - Zone-level things (zones, delivery rules) need `all` scope or an explicit zone grant.
- JWT carries `userId` + `roleId`; permissions and scope come from an in-memory cache refreshed on role/user edit.
- UI hiding is convenience; the API check is enforcement. Sensitive actions write to `audit_log` (🔒).

## 2. Roles

| Role | Who | Login | Notes |
|---|---|---|---|
| `guest` | Not logged in | none | Browse only after a zone is determined; login needed for checkout |
| `customer` | App/web buyer | phone + OTP (WhatsApp, SMS fallback) | Own data only |
| `rider` | Salaried delivery staff (6) | phone + OTP, pre-registered | One zone, one or more warehouses; **cannot reject orders** |
| `admin` | Store staff | email + password (+2FA) | All admin permissions, scope `all` at launch |
| `super_admin` | Owner / developer | email + password + 2FA | `*`; manages roles & users |

## 3. Customer & guest actions (`G` = also guest)

### 3.1 Auth, profile, location
| Key | Action | Notes |
|---|---|---|
| `auth:request_otp` (G) / `auth:verify_otp` (G) | Login OTP | WhatsApp first, SMS fallback button; 6 digits; rate-limited |
| `auth:refresh` / `auth:logout` | Tokens | |
| `profile:view` / `profile:update` / `profile:delete_request` | Own profile | |
| `location:resolve_zone` (G) | Send GPS/locality → zone | Decides catalog, prices, ETA |
| `address:list/create/update/delete/set_default` | Saved addresses | Requires locality + landmark; optional voice note + photo; resolves `zoneId`; address in another zone triggers cart re-price |
| `device:register_token` | FCM token | |
| `media:upload` | Get presigned upload URL for address voice note/photo, refund proof | Type/size limits; own files only (`06`) |
| `media:delete_own` | Delete own address voice note/photo | Deleted from S3 |
| `notification_pref:update` | Promo toggles | Transactional always on |

### 3.2 Browse
| Key | Action | Notes |
|---|---|---|
| `catalog:browse` (G) | Zone home, categories, list, detail | Zone-combined catalog, one price per product |
| `catalog:search` (G) | Search | |
| `catalog:changes` (G) | Delta sync feed | `since=<rev>` |
| `store:view_status` (G) | Open/closed, ETA range, fee notices (rain/night), pre-order windows | Per zone/warehouse |
| `banner:view` (G) | Banners | |
| `notify_me:subscribe` / `notify_me:unsubscribe` | Back-in-stock alert for out-of-stock item | Per zone; push + WhatsApp |

### 3.3 Cart & checkout
| Key | Action | Notes |
|---|---|---|
| `cart:view/sync/add_item/update_qty/change_variant/remove_item/clear` | Cart | Optimistic on device; server-synced |
| `coupon:apply` / `coupon:remove` | Coupon | Server-validated |
| `quote:get` | Quote (bill, charges, ETA, allocation summary) | Valid ~5 min |
| `order:place_cod` / `order:place_online` / `order:place_preorder` | Place order from a quote | Idempotency key; pre-order only when closed and enabled |
| `payment:verify` / `payment:retry` | Razorpay | Webhook is truth |
| `payment:pay_online_link` | Pay a COD group online before cash is collected | |

### 3.4 Orders & tracking
| Key | Action | Notes |
|---|---|---|
| `order:list_own` / `order:view_own` | History, detail (group + child orders) | |
| `order:track` | Poll tracking (status, rider position, ETA) | Also via expiring public link token |
| `order:cancel_own` | Cancel | Until `customerCancelUntil`; split groups: per child, fee rules in `02` §14 |
| `order:reorder` | Re-add items | |
| `order:view_delivery_otp` | See 4-digit delivery OTP | |
| `rider:call` | Call assigned rider | |
| `refund:request` / `refund:view_own` | Refunds | Window/photo per settings |
| `support:contact` | Support | |
| `feedback:rate_order` | Rating | Phase 2 |

## 4. Rider actions (own data, own zone)

| Key | Action | Notes |
|---|---|---|
| `rider_shift:start` | Punch in + go online, choose warehouse | Geo-tagged: must be within `punchInRadiusMeters` of the warehouse (flag if not) |
| `rider_shift:switch_warehouse` | Change current warehouse mid-shift | Admin can also override |
| `rider_shift:break` / `rider_shift:end` | Break / end | End blocked with active orders or unsynced outbox |
| `rider_assignment:list` | See assigned orders/batches | |
| `rider_assignment:acknowledge` | Acknowledge assignment | **No reject.** Unacknowledged in 2 min → WhatsApp + admin alert |
| `rider_order:report_problem` | Tell admin about a problem (vehicle issue, road blocked) | Creates an alert, does not unassign; admin decides/hands over |
| `rider_order:view` | Items, address, landmark, voice note, amount due, payment status | |
| `rider_order:navigate` | Open Google Maps | |
| `rider_order:call_customer` | Phone/WhatsApp call | |
| `rider_order:pickup` | Checklist (items verified, bag count) → `PICKED_UP` | Downloads offline bundle |
| `rider_order:start_ride` | → `OUT_FOR_DELIVERY` | One tap with pickup when single stop |
| `rider_order:arrived` | → `ARRIVED` | Notifies customer |
| `rider_order:verify_delivery_otp` | OTP check (local + server) | Works offline |
| `rider_order:collect_cash` | Confirm cash for `amountDue` | Ledger entry (order's warehouse) |
| `rider_order:generate_upi_qr` | Local UPI QR | Records `upi_unverified` |
| `rider_order:deliver` | → `DELIVERED` (`deliveredOffline` when no network) | |
| `rider_order:report_failed` | Failed delivery (unreachable, wrong address, refused, road blocked, weather) + photo | Alerts admin |
| `rider_sync:push` | Upload offline event queue | Idempotent |
| `rider_location:update` | Location | ~10 s on order, ~60 s idle |
| `rider_cash:view` / `rider_history:view` / `rider_profile:view` / `rider_profile:update_photo` | Own cash (per warehouse), history, profile | |
| `media:upload` | Upload failed-delivery photo | Presigned, retry queue |
| `device:register_token` / `auth:*` | | Invite-only phone |

## 5. Admin actions

`:view` = read-only, `:manage` = everything in the module. 🔒 = audited. All keys respect `users.scope`.

| Key | Module | Actions covered |
|---|---|---|
| `dashboard:view` | Dashboard | Today's orders, revenue, active riders, pending refunds, low stock, offline-delivery reviews; all or per warehouse |
| `reports:view` | Reports | Sales, funnel, cancellations, COD cash by rider/warehouse/day, promised vs actual delivery time, rider hours, wastage, surcharge income, CSV |
| `orders:view` | Orders | List (group + children), timeline, notes, print thermal bill/packing slip |
| `orders:manage` | Orders | Confirm (manual mode), start/complete packing, mark unavailable 🔒, edit items before dispatch 🔒, cancel with reason 🔒, force status 🔒, fix collection 🔒, resolve failed delivery 🔒, review offline deliveries 🔒 |
| `dispatch:manage` | Dispatch | Live board; assign/reassign 🔒; **create batches incl. pickups from several warehouses; choose same/different rider for a split order**; handover 🔒; ack status; delayed/unacknowledged alerts; rider map |
| `catalog:view` / `catalog:manage` | Master catalog | Categories, products, variants (label, weight, sku), images (S3; removing one deletes it from S3 🔒), tags, CSV import/export 🔒; delete/archive 🔒 |
| `warehouse_catalog:view` | Warehouse products | Product **tree** (Category → Product → Variants) for a warehouse |
| `warehouse_catalog:manage` | Warehouse products | Add products to a warehouse, edit price/MRP/sale/qty single or bulk 🔒, on/off, same-zone price rule enforcement |
| `catalog:import` | Import | **Import products from another warehouse** (single/bulk), preview and edit price/qty 🔒 |
| `stock:view` / `stock:manage` | Inventory | Levels, movements; adjust with reason 🔒, stock-take 🔒 |
| `notify_demand:view` | Notify Me | Demand list by product/zone |
| `pricing:manage` | Offers | Bulk price changes 🔒, scheduled sale 🔒, coupons (incl. `free_delivery`), banners |
| `customers:view` / `customers:manage` | Customers | Search, history; block 🔒, COD allow/deny 🔒, delete 🔒, export 🔒 |
| `riders:view` / `riders:manage` | Riders | List, shifts, attendance; onboard/edit incl. zone and allowed warehouses 🔒, deactivate 🔒, force offline 🔒 |
| `cash:manage` | Rider cash | Ledger by rider/warehouse, record deposit 🔒, adjust 🔒, resolve `overpaid`/`unmatched`, reconcile `upi_unverified` 🔒 |
| `payments:view` / `payments:manage` | Payments | Razorpay status; reconcile; mark stuck paid 🔒 |
| `refunds:manage` | Refunds | Pending/done, create, approve, reject, mark done 🔒 |
| `warehouses:view` / `warehouses:manage` | Warehouses | Create/edit warehouse (zone, location, hours, afterHoursMode, pre-order slots, pack/rider-arrival times, priority, UPI VPA 🔒), enable/disable 🔒 |
| `zones:manage` | Zones & localities | Draw polygons (no overlap), cities, localities, enable/disable 🔒, pause orders 🔒 |
| `delivery_rules:manage` | Fees | Fee tiers, always-free, min order, surcharges, fee preview 🔒 |
| `ops_mode:manage` | Ops switches | Rain mode on/off with end time, pause orders (per warehouse/zone) 🔒 – for floor staff without full settings access |
| `notifications:manage` | Notifications | Templates 🔒, broadcast 🔒, log, retry |
| `settings:view` / `settings:manage` | Settings | All groups with scope (global/zone/warehouse) 🔒 |
| `staff:manage` | Staff | Accounts, scope, reset password/2FA 🔒 |
| `roles:manage` | Roles | Roles by ticking keys 🔒 (`super_admin` only at launch) |
| `audit:view` | Audit | Search |

## 6. System / background actions

| Job | Trigger | Does |
|---|---|---|
| Payment expiry | Every minute | Cancel unpaid online groups; restore stock |
| Acknowledgement sweeper | ~10 s | No ack by `ackDeadlineAt` → WhatsApp rider, alert admin |
| Auto-assign | Child → `READY` and mode `auto` | Pick rider, assign, start ack timer |
| Allocation | Quote/checkout | Assign cart lines to warehouses; split if needed |
| Notification worker | `jobs` | Push/WhatsApp/SMS with retries |
| Razorpay webhook handler | `payment.*` | Confirm/fail (idempotent) |
| Reconciliation | Daily | Razorpay vs DB |
| Low-stock alert | Stock change | Notify admin |
| Notify Me trigger | Zone availability 0 → >0 | Push + WhatsApp to subscribers (throttled, one-shot) |
| Hours & pre-orders | Per settings | Open/close warehouses; release pre-orders into packing before slot |
| Surcharge expiry | Minute | Turn rain mode off at `activeUntil` |
| Abandoned cart | 30 min idle (setting) | Optional push/WhatsApp nudge to opted-in users |
| Owner digest | Daily 20:00 (setting) | WhatsApp summary: orders, revenue, per-warehouse split, pending rider cash |
| Rider offline sweep | Periodic | Mark offline on stale ping; alert admin if on order |
| Offline review flagging | On sync | Flag OTP mismatch / GPS far / device-time skew |
| OTP/session cleanup | TTL | |

## 7. Role → permission matrix (launch)

| Module | guest | customer | rider | admin | super_admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Zone resolve / browse / search | ✔ | ✔ | – | ✔ | ✔ |
| Auth & own profile | OTP only | ✔ | ✔ | ✔ | ✔ |
| Cart, quote, checkout, own orders, Notify Me | – | ✔ | – | – | – |
| Shift, ack, delivery, offline sync, cash | – | – | ✔ | – | – |
| Orders, dispatch, catalog, warehouse catalog, import, stock | – | – | – | ✔ | ✔ |
| Customers, riders, cash, payments, refunds | – | – | – | ✔ | ✔ |
| Warehouses, zones, delivery rules, ops mode, settings | – | – | – | ✔ | ✔ |
| Staff & roles edit | – | – | – | – | ✔ |
| Audit log | – | – | – | ✔ | ✔ |

## 8. Decisions

1. Order confirmation (auto/manual) is a setting `orderConfirmMode`.
2. Customer cancel cutoff: before `PACKING` (setting).
3. No phone-created orders at launch; no rider documents at launch.
4. Riders cannot reject; they acknowledge, and may report a problem for admin to act on.
5. Staff data scope by warehouse is enforced server-side from day one, even though launch staff have `all`.
