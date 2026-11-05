# F02 – Roles & Permissions

Status: draft v3 · Folder: foundation · Depends on: F01 · See also: F25 (staff, audit)

## 1. Purpose
Control who can do what. Roles are rows in the database; every API route checks a permission key; staff data is limited by warehouse scope.

## 2. Actors
`guest` · `customer` · `rider` · `admin` · `super_admin`.

| Role | Who | Login | Notes |
|---|---|---|---|
| guest | Not logged in | none | Browse only after a zone is known; login needed for checkout |
| customer | App/web buyer | phone + OTP | Own data only |
| rider | Salaried delivery staff (6) | phone + OTP, pre-registered | One zone, one or more warehouses; cannot reject orders |
| admin | Store staff | email + password (+2FA) | All admin permissions, scope `all` at launch |
| super_admin | Owner / developer | email + password + 2FA | `*`; manages roles and users |

## 3. Rules

1. **One role per user** (`users.roleId`). Roles are rows in `roles`, not code.
2. Every protected route uses `requirePermission('<key>')`. Routes never check role names.
3. **Key format:** `module:view` / `module:manage` for admin; fixed `module:action` for customer and rider. The full list is registered in code and seeded to the DB at startup.
4. **System roles** (`isSystem`, cannot be deleted): `super_admin` (`*`), `customer`, `rider`. Launch staff role: one `admin` with all admin keys. Later roles (Packer, Dispatcher, Warehouse Manager, Support) are new rows with subsets, no deploy.
5. **Data scope:**
   - Customer and rider: own data only. A rider sees only orders assigned to them in their zone.
   - Staff: `users.scope = { all: true }` or `{ warehouseIds: [...] }`. Every admin query is filtered by scope on the server. `super_admin` and the owner's `admin` have `all`.
   - Zone-level settings (zones, delivery rules) need `all` scope or an explicit zone grant.
6. JWT carries `userId` + `roleId`; permissions and scope come from an in-memory cache refreshed on role or user edit.
7. UI hiding is convenience; the API check is enforcement. Sensitive actions write to `audit_log` (🔒).

## 4. Admin permission catalog

`:view` = read-only, `:manage` = everything in the module. 🔒 = audited.

| Key | Module | Covers |
|---|---|---|
| `dashboard:view` | Dashboard | Orders, revenue, riders, pending refunds, low stock, offline-delivery reviews |
| `reports:view` | Reports | Sales, funnel, COD cash, promised vs actual time, wastage, surcharge income, CSV |
| `orders:view` / `orders:manage` | Orders | List, timeline, print; confirm, pack, mark unavailable 🔒, edit 🔒, cancel 🔒, force status 🔒, fix collection 🔒, failed delivery 🔒, review offline deliveries 🔒 |
| `dispatch:manage` | Dispatch | Board, assign/reassign 🔒, batches across warehouses, same/different rider, handover 🔒 |
| `catalog:view` / `catalog:manage` | Master catalog | Categories, products, variants, images (removal deletes from S3 🔒), CSV 🔒 |
| `warehouse_catalog:view` / `:manage` | Warehouse products | Tree view, price/qty edits 🔒, bulk edit |
| `catalog:import` | Import | Import from another warehouse 🔒 |
| `stock:view` / `stock:manage` | Inventory | Levels, movements, adjust 🔒, stock-take 🔒 |
| `notify_demand:view` | Notify Me | Demand list |
| `pricing:manage` | Offers | Bulk price 🔒, sale price 🔒, coupons, banners |
| `customers:view` / `customers:manage` | Customers | Search; block 🔒, COD deny 🔒, delete 🔒, export 🔒 |
| `riders:view` / `riders:manage` | Riders | List, shifts; onboard with zone and warehouses 🔒, deactivate 🔒 |
| `cash:manage` | Rider cash | Ledger, deposits 🔒, adjustments 🔒, UPI reconciliation 🔒 |
| `payments:view` / `payments:manage` | Payments | Razorpay status, reconcile, mark paid 🔒 |
| `refunds:manage` | Refunds | Approve, reject, mark done 🔒 |
| `warehouses:view` / `warehouses:manage` | Warehouses | Hours, pre-order slots, pack times, UPI VPA 🔒 |
| `zones:manage` | Zones & localities | Polygons, cities, localities 🔒, pause 🔒 |
| `delivery_rules:manage` | Fees | Tiers, free zones, surcharges, preview 🔒 |
| `ops_mode:manage` | Ops switches | Rain mode, pause orders 🔒 (for floor staff) |
| `notifications:manage` | Notifications | Templates 🔒, broadcast 🔒, log |
| `settings:view` / `settings:manage` | Settings | All groups with scope 🔒 |
| `staff:manage` | Staff | Accounts, scope, reset 🔒 |
| `roles:manage` | Roles | Edit roles 🔒 (`super_admin` only at launch) |
| `audit:view` | Audit | Search |

Customer and rider keys are listed in the feature docs that own them (F01, F08–F10, F13–F16, F19, F22).

## 5. Role → permission matrix (launch)

| Module | guest | customer | rider | admin | super_admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Zone resolve, browse, search | ✔ | ✔ | – | ✔ | ✔ |
| Auth, own profile | OTP only | ✔ | ✔ | ✔ | ✔ |
| Cart, quote, checkout, own orders, Notify Me | – | ✔ | – | – | – |
| Shift, ack, delivery, offline sync, cash | – | – | ✔ | – | – |
| Orders, dispatch, catalog, warehouse catalog, import, stock | – | – | – | ✔ | ✔ |
| Customers, riders, cash, payments, refunds | – | – | – | ✔ | ✔ |
| Warehouses, zones, delivery rules, ops mode, settings | – | – | – | ✔ | ✔ |
| Staff and roles edit | – | – | – | – | ✔ |
| Audit log | – | – | – | ✔ | ✔ |

## 6. Screens (admin)
Roles list · role editor (tick permission keys) · staff list · staff editor (role + warehouse scope) · audit log.

## 7. API
`GET/POST/PUT/DELETE /admin/roles` · `GET/POST/PUT /admin/staff` · `GET /admin/permissions` (registered keys) · `GET /admin/audit`.

## 8. Data

**roles**: `name` (unique), `permissions` string[] (`*` = all), `isSystem`.
`users.scope`: see F01. `audit_log` is owned by F25.

## 9. Decisions
1. Order confirmation (auto/manual) is a setting (F14).
2. No phone-created orders and no rider documents at launch.
3. Warehouse scope is enforced server-side from day one, even though launch staff have `all`.
4. Packer role scoped by warehouse is deferred (F25 open question).
