# F25 – Admin Panel, Settings & Reports

Status: draft v3 · Folder: platform · Depends on: F02, F03 · See also: every feature doc (each lists its own settings)

## 1. Purpose
One Next.js admin panel (`/admin`) for the owner and staff to run the store, with **all business settings editable without a redeploy**, plus the dashboard, reports, staff management and audit log.

## 2. Panel modules

| Module | Feature doc |
|---|---|
| Dashboard (all warehouses or one) | this doc |
| Orders, packing, print bill | F14 |
| Dispatch board | F18 |
| Master catalog | F04 |
| Warehouse products tree and import | F06 |
| Inventory | F05 |
| Pricing, coupons, banners | F12 |
| Customers | this doc |
| Riders (zone, warehouses, shifts) | F19 |
| Rider cash and reconciliation | F22 |
| Payments and refunds | F15, F16 |
| Zones, cities, localities, warehouses | F03 |
| Delivery rules and ops mode (rain, pause) | F11, F17 |
| Notify-Me demand | F07 |
| Notification templates | F23 |
| Reports | this doc |
| Staff and roles | F02 |
| Audit log | this doc |
| Settings | this doc |

The panel polls for live data (orders every ~5 s), with a warehouse switcher; scoped staff only see their warehouses (F02). Built in Next.js (client components for live pages).

## 3. Settings system

- Stored in the `settings` collection with **scope resolution: warehouse → zone → global → code default** (most specific wins).
- Defaults live in code; the DB holds overrides. A registry validates every key (type, range, dependencies such as COD cap ≥ 0, tiers without gaps).
- **Change flow:** admin opens a group and scope → edits → backend validates → writes a new version, `settings_history` and `audit_log` 🔒 → the in-memory cache refreshes immediately → takes effect on the next request or job. Existing quotes keep their locked values until they expire.
- **Fee-affecting changes show a preview first** (F11).
- **Secrets** (Razorpay, WhatsApp, Google, AWS/S3, SMS keys) are never stored here; they stay in environment config. The warehouse UPI VPA is stored on the warehouse record and audited.
- Groups: `store, delivery, eta, hours, preOrder, assignment, payments, discounts, stock, orders, media, auth, app, tax, notifications`.

### Settings registry (initial keys, all placeholders until real numbers are entered)

| Group | Key | Scope | Placeholder | Doc |
|---|---|---|---|---|
| delivery | `smallOrderFee`, `smallOrderThreshold` | zone | 0 / 0 (off) | F11 |
| delivery | `handlingFee` | zone | 0 | F11 |
| delivery | `surchargeCap` | zone | ₹40 | F11 |
| delivery | `feeBasis` | zone | `afterDiscount` | F11 |
| eta | `packMinutes`, `riderArrivalMinutes` | warehouse | 5 / 5 | F20 |
| eta | `defaultTravelMinutes` | warehouse | 10 | F20 |
| eta | `busyBufferMinutes`, `busyThreshold` | zone | off | F20 |
| eta | `maxOpenOrdersPerRider` | zone | 2 | F20 |
| eta | `quoteValiditySeconds` | global | 300 | F10 |
| hours | `afterHoursMode`, `lastOrderMinutesBeforeClose` | warehouse | `closed` / 15 | F17 |
| preOrder | `enabled`, `slots`, `cutoffMinutesBeforeSlot` | warehouse | off | F17 |
| preOrder | `packLeadMinutes` | warehouse | 45 | F17 |
| assignment | `assignmentMode`, `ackTimeoutSeconds`, `maxActiveOrders` | zone | `manual` / 120 / 2 | F18 |
| assignment | `punchInRadiusMeters` | warehouse | 150 | F19 |
| assignment | `deliveryGeofenceMeters` | zone | 300 | F21 |
| payments | `codEnabled`, `codMaxAmount`, `onlineEnabled`, `onlineOrderExpiryMinutes` | zone | on / ₹2000 / on / 15 | F15 |
| payments | `payLinkForCodEnabled` | global | on | F15 |
| payments | `refundWindowHours`, `refundPhotoRequired`, `refundEligibleCategories` | global | 24 / on / perishables | F16 |
| stock | `zonePriceConflictMode`, `maxQtyPerItem`, `lowStockThreshold` | global | `block` / 10 / 5 | F05 |
| stock | `reservationTimeoutMinutes` | global | equals online expiry | F05 |
| orders | `orderConfirmMode` | warehouse | `auto` | F14 |
| orders | `customerCancelUntil` | global | `CONFIRMED` | F14 |
| orders | `slaMinutes` per state | zone | confirm 5, pack 15, assign 5 | F14 |
| orders | `maxSplitsPerOrder`, `maxItemsPerOrder` | global | 2 / 40 | F13 |
| media | `orderMediaRetentionDays`, `evidenceRetentionDays`, `maxImageMB`, `maxVoiceSeconds`, `maxVoiceKB` | global | **7** / 90 / 5 / 10 / 500 | F24 |
| auth | `loginOtpLength`, `deliveryOtpLength`, `otpMaxPerHour`, `deliveryOtpEnabled` | global | 6 / 4 / 5 / on | F01 |
| app | `minAppVersion`, `maintenanceMode`, `supportNumber`, "Download App" link | global | – | F01 |
| notifications | `abandonedCartMinutes`, `ownerDigestTime` | global | 30 / 20:00 | F23 |
| store | name, logo, contact, FSSAI/GST numbers | global | – | F04 |
| tax | GST rates, inclusive/exclusive | global | – | F11 |

## 4. Dashboard and reports

**Dashboard** (all or per warehouse): today's orders and revenue, active riders, pending refunds, low stock, offline-delivery reviews, rider cash outstanding, unacknowledged assignments and delayed orders.

**Reports** (`reports:view`, CSV export): sales by day, product, category and warehouse · order funnel and cancellations · COD cash by rider, warehouse and day · rider deliveries and shift hours · promised vs actual delivery time by warehouse and hour · stock movement and wastage · surcharge income (rain, night) · Notify-Me demand · coupon usage.

## 5. Customers and staff
- **Customers** (`customers:view/manage`): search, profile, order history, addresses; block 🔒, allow or deny COD 🔒, finalise account deletion 🔒, export 🔒, internal notes.
- **Staff** (`staff:manage`): create, update, deactivate; set role and warehouse scope; reset password or 2FA 🔒; force logout 🔒 (F02).

## 6. Audit log
Sensitive actions (🔒 in each doc) write `audit_log` with actor, role, action, entity, before/after, reason, IP. Searchable by entity and actor (`audit:view`).

## 7. Admin day-to-day

| Time | Flow |
|---|---|
| Open | Dashboard, low stock, pending refunds, unreconciled UPI; end "pause" if used; check rain mode; riders punch in |
| Live | New-order bell (board polls every ~5 s) → confirm → pack → ready → assign or batch (same or different rider for split orders) → watch ack status and delays |
| Weather | `ops_mode:manage` toggles rain mode with an end time |
| Close | Resolve failed deliveries, review offline deliveries, record cash deposits per warehouse, reconcile UPI, mark refunds done, stock-take; 20:00 owner digest arrives |

## 8. Screens
Dashboard · every module list and editor named in §2 · settings editor (group, scope selector, preview) · settings history · audit log · login with 2FA.

## 9. API
Full request and response reference with examples: [API · F25](../api/F25-admin-panel-settings-and-reports.md).

`GET/PUT /admin/settings/:group?scope=` · `GET /admin/settings/history` · `GET /admin/dashboard?warehouseId=` · `GET /admin/reports/:name` · `GET/PUT /admin/customers` · `GET /admin/audit`.

## 10. Data
**settings**: `group`, `key`, `scope {type: global/zone/warehouse, id?}`, `value`, `version`, `updatedBy`. Unique `(group, key, scope.type, scope.id)`.
**settings_history**: `group`, `key`, `scope`, `oldValue`, `newValue`, `by`, `at`.
**audit_log**: `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `before?`, `after?`, `reason?`, `ip`, `at`. Index `(entityType, entityId)`, `(actorId, at)`.

## 11. Permissions
`settings:view`, `settings:manage` (🔒), `dashboard:view`, `reports:view`, `customers:view`, `customers:manage`, `staff:manage`, `roles:manage`, `audit:view`.

## 12. Open questions
1. Packing station: one shared admin device or a login per packer (scoped Packer role)?
2. Real numbers for every placeholder in the registry.
3. Admin session security: httpOnly cookie, CSRF protection, CORS and CSP for the Next.js panel (decide at build).
