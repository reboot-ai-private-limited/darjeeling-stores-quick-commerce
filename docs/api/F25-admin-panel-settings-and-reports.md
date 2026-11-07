# API · F25 Admin Panel, Settings & Reports

Spec: [F25](../platform/25-admin-panel-settings-and-reports.md) · Conventions: [00](00-conventions.md)

Settings, dashboard, reports, customers and audit. Staff, roles and 2FA are in [F01](F01-authentication.md) and [F02](F02-roles-and-permissions.md).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Liveness check |
| `GET` | `/admin/settings/registry` | Admin `settings:view` | Every setting key with type, default and scope |
| `GET` | `/admin/settings/:group` | Admin `settings:view` | Settings of a group at a scope |
| `PUT` | `/admin/settings/:group` | Admin `settings:manage` | Change settings 🔒 |
| `GET` | `/admin/settings/history` | Admin `settings:view` | Change history |
| `GET` | `/admin/dashboard` | Admin `dashboard:view` | Today's numbers |
| `GET` | `/admin/reports` | Admin `reports:view` | List available reports |
| `GET` | `/admin/reports/:name` | Admin `reports:view` | Run a report (JSON or CSV) |
| `GET` | `/admin/customers` | Admin `customers:view` | Search customers |
| `GET` | `/admin/customers/:id` | Admin `customers:view` | Profile, orders, addresses |
| `PUT` | `/admin/customers/:id` | Admin `customers:manage` | Edit COD flag and notes 🔒 |
| `POST` | `/admin/customers/:id/block` | Admin `customers:manage` | Block 🔒 |
| `POST` | `/admin/customers/:id/unblock` | Admin `customers:manage` | Unblock 🔒 |
| `POST` | `/admin/customers/:id/finalise-deletion` | Admin `customers:manage` | Anonymise after a deletion request 🔒 |
| `GET` | `/admin/customers/export` | Admin `customers:manage` | CSV export 🔒 |
| `GET` | `/admin/audit` | Admin `audit:view` | Search the audit log |

## GET /health
200: `{ "status": "ok" }` (no `data` wrapper). Used by deploy checks.

## Settings
Settings live at a **scope**: `warehouse` → `zone` → `global`. The most specific one wins; the code default applies when nothing is set. Changes take effect on the next request. Secrets (Razorpay, WhatsApp, S3 keys) are never stored here.

### GET /admin/settings/registry
200:
```json
{
  "data": [
    { "group": "eta", "key": "packMinutes", "type": "integer", "min": 0, "max": 120, "default": 5, "scopes": ["warehouse", "zone", "global"], "description": "Minutes to pack an order" },
    { "group": "payments", "key": "codMaxAmount", "type": "integer", "unit": "paise", "default": 200000, "scopes": ["zone", "global"] },
    { "group": "stock", "key": "zonePriceConflictMode", "type": "enum", "values": ["block", "warn"], "default": "block", "scopes": ["global"] }
  ]
}
```
Use it to draw the settings forms and validate before saving. Groups: `store, delivery, eta, hours, preOrder, assignment, payments, discounts, stock, orders, media, auth, app, tax, notifications`.

### GET /admin/settings/:group
Query: `scopeType=global|zone|warehouse`, `scopeId`. 200:
```json
{
  "data": {
    "group": "eta",
    "scope": { "type": "warehouse", "id": "wh_1" },
    "values": [
      { "key": "packMinutes", "value": 6, "source": "warehouse", "version": 3 },
      { "key": "riderArrivalMinutes", "value": 5, "source": "global", "version": 1 },
      { "key": "defaultTravelMinutes", "value": 10, "source": "default", "version": 0 }
    ]
  }
}
```
`source` shows where the effective value comes from (`warehouse`, `zone`, `global`, `default`).

### PUT /admin/settings/:group
Body:
```json
{ "scope": { "type": "warehouse", "id": "wh_1" }, "values": { "packMinutes": 6 } }
```
Send `null` for a key to remove the override at that scope. 200: the same shape as the GET. Errors: `400 VALIDATION_ERROR` (`details` lists keys; also dependency rules such as fee tiers without gaps) · `403 FORBIDDEN` (scope). Each change writes `settings_history` and the audit log.

### GET /admin/settings/history
Query: `group`, `key`, `scopeId`, `from`, `to`, `limit`, `cursor`. 200 items: `{ "group", "key", "scope", "oldValue", "newValue", "by", "at" }`.

## GET /admin/dashboard
Query: `warehouseId` (omit for all permitted warehouses). 200:
```json
{
  "data": {
    "date": "2026-11-05",
    "orders": { "today": 48, "active": 6, "delivered": 39, "cancelled": 3 },
    "revenue": { "today": 982000 },
    "riders": { "online": 5, "onBreak": 1, "offline": 0 },
    "pendingRefunds": 2,
    "lowStock": 7,
    "offlineDeliveryReviews": 1,
    "reconciliationOpen": 3,
    "riderCashOutstanding": 54800,
    "unacknowledgedAssignments": 0,
    "delayedOrders": 1,
    "byWarehouse": [{ "warehouseId": "wh_1", "orders": 30, "revenue": 610000 }, { "warehouseId": "wh_2", "orders": 18, "revenue": 372000 }]
  }
}
```

## Reports
`GET /admin/reports` lists them: `sales`, `order-funnel`, `cod-cash`, `rider-deliveries`, `delivery-time` (promised vs actual by warehouse and hour), `stock-wastage`, `surcharge-income`, `notify-demand`, `coupon-usage`.

`GET /admin/reports/:name` query: `from`, `to`, `warehouseId`, `groupBy=day|warehouse|product|category|rider`, `format=json|csv`. JSON example (`sales`, `groupBy=day`):
```json
{
  "data": {
    "name": "sales", "from": "2026-11-01", "to": "2026-11-05", "groupBy": "day",
    "columns": ["date", "orders", "revenue", "avgOrderValue"],
    "rows": [["2026-11-05", 48, 982000, 20458]]
  }
}
```
Amounts are paise. `format=csv` returns `text/csv`. Totals match the underlying orders and ledgers; scoped staff only get their warehouses.

## Customers
Item and detail:
```json
{
  "id": "user_1", "name": "Asha Rai", "phone": "+919876543210", "status": "active",
  "codAllowed": true, "orderCount": 12, "lifetimeValue": 245000, "lastOrderAt": "2026-11-05T10:30:00Z",
  "blockedReason": null, "internalNotes": [{ "text": "Prefers evening delivery", "by": "Dorjee Lama", "at": "2026-10-20T07:00:00Z" }]
}
```
- `GET /admin/customers?q=&status=&codAllowed=&limit&cursor`; `GET /admin/customers/:id` adds `addresses[]` and `recentOrders[]`.
- `PUT /admin/customers/:id` body `{ "codAllowed": false, "note": "Refused 3 deliveries" }`.
- `block` body `{ "reason": "Fraud" }`; `unblock` no body.
- `finalise-deletion` anonymises the user (phone, name and email removed, orders and payments kept for accounting) and deletes their address media. Errors: `409 CONFLICT` (no deletion request).
- `export` returns `text/csv`.

## GET /admin/audit
Query: `entityType`, `entityId`, `actorId`, `action`, `from`, `to`, `limit`, `cursor`. 200:
```json
{
  "data": [{ "id": "aud_1", "actorId": "user_9", "actorRole": "admin", "action": "orders.cancel", "entityType": "order", "entityId": "ord_1", "before": { "status": "READY" }, "after": { "status": "CANCELLED" }, "reason": "Customer called to cancel", "ip": "203.0.113.5", "at": "2026-11-05T10:50:00Z" }],
  "meta": { "nextCursor": null }
}
```

## How it behaves today
Built in the `settings`, `reports`, `customers` and `audit` modules. Notes where the code is more specific than the examples above:

- **Scope rules.** Staff with all-warehouse access may use any scope. A warehouse-scoped manager may read and write only the `warehouse` scope of their own warehouses; zone and global settings, and every customer change (block, unblock, edit, finalise, export), need all-warehouse access. Settings history, audit and customer figures are filtered to the caller's warehouses. Asking for a warehouse outside the scope is `403 FORBIDDEN`.
- **Settings.** `PUT` sends only the keys to change; a key already at that value is skipped, writes no history and no audit. Unknown keys, keys not allowed at the scope, out-of-range values and broken cross-key rules (a rain surcharge above the surcharge cap, a packing SLA shorter than the confirm SLA) are `400 VALIDATION_ERROR` with `details: [{ key, message }]`, and nothing is saved. Two writers changing one key at once cannot both win; the loser gets `409 CONFLICT`. Opening hours, pre-order slots and pauses live with the warehouse (F17) and are not settings. Groups `auth`, `app`, `preOrder` and `notifications` exist but have no keys yet.
- **Live settings.** The cart and quote, pricing, stock and hours/pre-order modules read these settings on every request, so a change applies on the next one with no restart. Cart and quote: `orders` (`quoteValiditySeconds`, `maxItemsPerOrder`, `maxQtyPerItem`, `maxSplitsPerOrder`, `defaultMinOrder`), `eta` (`packMinutes`, `riderArrivalMinutes`, per warehouse), `payments.codMaxAmount`, `tax.taxInclusive`. Pricing: `discounts` (`surchargeCap`, where 0 means no limit, `rainSurchargeAmount`, `rainExtraMinutes`). Stock: `stock.lowStockGrams` and `lowStockUnits` (per warehouse) and `zonePriceConflictMode` (`block` refuses a price that differs from another warehouse of the zone, `warn` allows it). Hours and pre-orders: `hours.lastOrderMinutesBeforeClose`, `hours.afterHoursMode`, `preOrder.cutoffMinutesBeforeSlot`, `preOrder.packLeadMinutes`. The hours and pre-order keys are defaults for a warehouse whose admin leaves the field out; a value an admin saved for a warehouse is kept. Fee tiers, late-night and rain rules, coupons, opening hours and slots stay in their own screens and are already stored in the database. The remaining modules read the **global** value of their settings, refreshed right after every save (and every 30 seconds in case another process changed it): orders (`confirmMode`, `paymentWindowMinutes`, `customerCancelUntil`, `otpMaxTries`, the three SLA minutes), payments and refunds (`payLinkMinutes`, `refundWindowHours`, `refundPhotoRequired`, `maxRefundPhotos`), riders and dispatch (`assignment.*`, `delivery.punchInRadiusMeters`, `deliveryOtpEnabled`, the two location-ping intervals), tracking and ETA (`eta.averageSpeedKmh`, `detourFactor`, `extraMinutes`, `etaRefreshSeconds`, `tokenTtlHours`, `maxPointAgeDays`), offline sync (`geofenceMeters`, `maxClockSkewMinutes`), media (`media.*`) and discovery (`store.*`). Because they have no zone or warehouse to ask about, these keys can only be set at the global scope (the registry says so). What does not live in settings: secrets and addresses that come from the environment (the delivery-code key, the tracking link address, the UPI address, provider keys), the opening hours, slots and pauses of a warehouse, and the fee, surcharge and coupon rules, which are stored data.
- **Dashboard.** `orders.today` counts orders placed today (Indian time) that are not still waiting for online payment. `delivered` and `cancelled` are among those. `active` is every order in progress now, not only today's. `revenue.today` is items less discount plus fees, for today's orders that are not cancelled, in paise. `delayedOrders` are active, non-pre-order orders more than the `assignment.delayedAfterMinutes` setting past their promise. `lowStock` counts active warehouse offerings below the `stock.lowStockGrams` or `stock.lowStockUnits` setting.
- **Reports.** Dates are inclusive Indian days; the default is the last 7 days and the longest range is 366 days. A "sale" is an order that is not cancelled and not waiting for payment. Columns and allowed `groupBy`:

| Report | `groupBy` (first is the default) | Columns |
|---|---|---|
| `sales` | `day`, `warehouse`, `product`, `category` | `date`/`warehouse`, `orders`, `revenue`, `avgOrderValue` (product and category: `orders`, `units`, `revenue`) |
| `order-funnel` | `status`, `warehouse` | `status`, `orders` |
| `cod-cash` | `rider`, `day`, `warehouse` | group, `collected`, `deposited`, `adjusted`, `net` |
| `rider-deliveries` | `rider`, `day` | group, `deliveries`, `failed`, `avgMinutes` |
| `delivery-time` | `warehouse`, `day` | group, `hour`, `delivered`, `onTime`, `avgPromisedMinutes`, `avgActualMinutes` |
| `stock-wastage` | `product`, `warehouse`, `day` | group, `entries`, `gramsLost`, `unitsLost` |
| `surcharge-income` | `day`, `warehouse` | group, `rain`, `lateNight`, `other`, `total` |
| `notify-demand` | `product` | `product`, `waiting`, `customers` |
| `coupon-usage` | `coupon` | `coupon`, `uses`, `orders`, `discount` |

  Other modules add reports with `reportsModule.service.register(def)`. CSV text that starts with `=`, `+`, `-` or `@` is prefixed with `'` so a spreadsheet does not run it.
- **Customers.** `q` is a phone number (a 10-digit number is read as +91) or the start of a name. `block` works on active customers, `unblock` on blocked ones, `finalise-deletion` on customers who asked for deletion; any other status is `409 CONFLICT`. Finalising also refuses while the customer has an order in progress. It removes phone, email, addresses, carts, devices and login codes, cancels Notify Me, asks media to delete the address voice notes and photos, and keeps orders and payments. The response is `{ id, status, addressesRemoved, mediaRemoved, mediaFailed }`. Blocking ends the customer's sessions. The export is audited (`customers.export`), capped at 50,000 rows.
- **Audit.** `before` and `after` come from the record's change snapshot. Customer, setting and staff changes carry one; others show `null`. `reason` is set for blocks and notes. There is no endpoint that changes or deletes an audit record. Cursor paging is by newest first.
- **Cookie sessions.** A change made with a cookie session needs a trusted `Origin` and `X-CSRF-Token: 1`; a bearer token is exempt.
