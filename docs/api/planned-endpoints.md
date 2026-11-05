# Proposed API endpoint catalog

These endpoint designs describe intended behavior, not implemented routes. See [current API reference](README.md) for existing behavior. No machine-readable API generator is configured. The catalog count below is inherited from the upstream design and has not been independently verified.

Status: draft v1 · Generated from the per-feature files in this folder · **259 endpoints** across 25 features

Start with [00-conventions.md](00-conventions.md) (envelopes, auth, errors, pagination, idempotency, polling). Then open the file for the feature you are building: each endpoint shows who can call it, the request, example success responses and the errors to handle, so the apps can be built and compared against the backend.

**Auth column:** `Public` no token · `Auth` any logged-in user · `Customer` · `Rider` · `Admin perm` staff with that permission key · `Webhook` provider signature · `Token link` expiring public link.

## Feature files

| Feature | File | Endpoints |
|---|---|---|
| F01 Authentication | [F01-authentication.md](F01-authentication.md) | 16 |
| F02 Roles & Permissions | [F02-roles-and-permissions.md](F02-roles-and-permissions.md) | 15 |
| F03 Cities, Zones & Warehouses | [F03-zones-and-warehouses.md](F03-zones-and-warehouses.md) | 18 |
| F04 Master Catalog | [F04-master-catalog.md](F04-master-catalog.md) | 20 |
| F05 Warehouse Stock & Pricing | [F05-warehouse-stock-and-pricing.md](F05-warehouse-stock-and-pricing.md) | 10 |
| F06 Product Import & Admin Product Tree | [F06-product-import-and-admin-tree.md](F06-product-import-and-admin-tree.md) | 3 |
| F07 Notify Me (Back in Stock) | [F07-notify-me.md](F07-notify-me.md) | 4 |
| F08 Discovery & Location | [F08-discovery-and-location.md](F08-discovery-and-location.md) | 9 |
| F09 Addresses | [F09-addresses.md](F09-addresses.md) | 6 |
| F10 Cart & Quote | [F10-cart-and-quote.md](F10-cart-and-quote.md) | 6 |
| F11 Delivery Fees & Surcharges | [F11-delivery-fees-and-surcharges.md](F11-delivery-fees-and-surcharges.md) | 7 |
| F12 Coupons & Offers | [F12-coupons-and-offers.md](F12-coupons-and-offers.md) | 11 |
| F13 Order Placement & Split Orders | [F13-order-placement-and-split-orders.md](F13-order-placement-and-split-orders.md) | 5 |
| F14 Order Lifecycle & Packing | [F14-order-lifecycle-and-packing.md](F14-order-lifecycle-and-packing.md) | 13 |
| F15 Payments | [F15-payments.md](F15-payments.md) | 10 |
| F16 Cancellations & Refunds | [F16-cancellations-and-refunds.md](F16-cancellations-and-refunds.md) | 10 |
| F17 Hours, Pre-orders & Ops Mode | [F17-hours-preorders-and-ops-mode.md](F17-hours-preorders-and-ops-mode.md) | 7 |
| F18 Dispatch, Assignment & Handover | [F18-dispatch-and-assignment.md](F18-dispatch-and-assignment.md) | 13 |
| F19 Rider App | [F19-rider-app.md](F19-rider-app.md) | 27 |
| F20 ETA & Live Tracking | [F20-eta-and-live-tracking.md](F20-eta-and-live-tracking.md) | 3 |
| F21 Offline-First & Low Network | [F21-offline-and-low-network.md](F21-offline-and-low-network.md) | 4 |
| F22 Rider Cash & Settlement | [F22-rider-cash-and-settlement.md](F22-rider-cash-and-settlement.md) | 10 |
| F23 Notifications | [F23-notifications.md](F23-notifications.md) | 10 |
| F24 Media Storage (S3) | [F24-media-storage.md](F24-media-storage.md) | 7 |
| F25 Admin Panel, Settings & Reports | [F25-admin-panel-settings-and-reports.md](F25-admin-panel-settings-and-reports.md) | 16 |

## All endpoints

`↗ Fxx` means the endpoint is also listed in another feature file (the first one is where it is described).

### F01 · Authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/request-otp` | Public | Send a login OTP by WhatsApp (SMS fallback) |
| `POST` | `/auth/verify-otp` | Public | Verify the OTP and log in (creates a customer on first login) |
| `POST` | `/auth/refresh` | Public | Swap a refresh token for a new session |
| `POST` | `/auth/logout` | Auth | Revoke the refresh token |
| `POST` | `/admin/auth/login` | Public | Staff login with email, password and optional 2FA code |
| `POST` | `/admin/auth/2fa/setup` | Admin (any) | Start 2FA enrolment |
| `POST` | `/admin/auth/2fa/enable` | Admin (any) | Confirm 2FA with a first code |
| `GET` | `/me` | Auth | Current user's profile |
| `PUT` | `/me` | Auth | Update name or email |
| `POST` | `/me/phone/request-otp` | Customer | Send an OTP to a new phone number |
| `POST` | `/me/phone/verify` | Customer | Confirm the new phone number |
| `GET` | `/me/access` | Auth | Role, permission keys and warehouse scope |
| `POST` | `/me/delete-request` | Customer | Ask for account deletion |
| `POST` | `/devices` | Auth | Register or refresh the FCM push token |
| `DELETE` | `/devices/:fcmToken` | Auth | Remove a push token (on logout) |
| `GET` | `/app/config` | Public | Force-update, maintenance and support info |

### F02 · Roles & Permissions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/permissions` | Admin `roles:manage` | Every registered permission key, grouped |
| `GET` | `/admin/roles` | Admin `roles:manage` | List roles |
| `POST` | `/admin/roles` | Admin `roles:manage` | Create a role |
| `GET` | `/admin/roles/:id` | Admin `roles:manage` | One role |
| `PUT` | `/admin/roles/:id` | Admin `roles:manage` | Replace a role's permission keys |
| `DELETE` | `/admin/roles/:id` | Admin `roles:manage` | Delete a role (not system, not in use) |
| `GET` | `/admin/staff` | Admin `staff:manage` | List staff accounts |
| `POST` | `/admin/staff` | Admin `staff:manage` | Create a staff account |
| `GET` | `/admin/staff/:id` | Admin `staff:manage` | One staff account |
| `PUT` | `/admin/staff/:id` | Admin `staff:manage` | Change name, role or warehouse scope |
| `POST` | `/admin/staff/:id/deactivate` | Admin `staff:manage` | Deactivate and revoke sessions |
| `POST` | `/admin/staff/:id/reactivate` | Admin `staff:manage` | Reactivate |
| `POST` | `/admin/staff/:id/reset-password` | Admin `staff:manage` | Set a new temporary password |
| `POST` | `/admin/staff/:id/reset-2fa` | Admin `staff:manage` | Remove 2FA so the user can re-enrol |
| `POST` | `/admin/staff/:id/force-logout` | Admin `staff:manage` | Revoke all sessions |

### F03 · Cities, Zones & Warehouses

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/location/resolve` | Public | Turn a GPS point or locality into a zone |
| `POST` | `/zones/check` | Public | Same as resolve (kept for address forms) |
| `GET` | `/cities` | Public | Cities for the picker |
| `GET` | `/localities` | Public | Localities (areas, bustys, roads) of a city |
| `GET` | `/admin/cities` | Admin `zones:manage` | List cities (including inactive) |
| `POST` | `/admin/cities` | Admin `zones:manage` | Create a city |
| `PUT` | `/admin/cities/:id` | Admin `zones:manage` | Update a city |
| `GET` | `/admin/localities` | Admin `zones:manage` | List localities |
| `POST` | `/admin/localities` | Admin `zones:manage` | Create a locality |
| `PUT` | `/admin/localities/:id` | Admin `zones:manage` | Update a locality |
| `GET` | `/admin/zones` | Admin `zones:manage` | List zones with polygons |
| `POST` | `/admin/zones` | Admin `zones:manage` | Create a zone (polygon, no overlap) |
| `GET` | `/admin/zones/:id` | Admin `zones:manage` | One zone |
| `PUT` | `/admin/zones/:id` | Admin `zones:manage` | Edit polygon, name, enabled or pause |
| `GET` | `/admin/warehouses` | Admin `warehouses:view` | List warehouses (scoped) |
| `POST` | `/admin/warehouses` | Admin `warehouses:manage` | Create a warehouse in a zone |
| `GET` | `/admin/warehouses/:id` | Admin `warehouses:view` | One warehouse |
| `PUT` | `/admin/warehouses/:id` | Admin `warehouses:manage` | Edit a warehouse |

### F04 · Master Catalog

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/categories` | Admin `catalog:view` | Category tree |
| `POST` | `/admin/categories` | Admin `catalog:manage` | Create a category |
| `PUT` | `/admin/categories/:id` | Admin `catalog:manage` | Edit, move or toggle a category |
| `DELETE` | `/admin/categories/:id` | Admin `catalog:manage` | Delete an empty category |
| `POST` | `/admin/categories/reorder` | Admin `catalog:manage` | Reorder siblings |
| `GET` | `/admin/products` | Admin `catalog:view` | Search and filter products |
| `POST` | `/admin/products` | Admin `catalog:manage` | Create a product with variants |
| `GET` | `/admin/products/:id` | Admin `catalog:view` | One product |
| `PUT` | `/admin/products/:id` | Admin `catalog:manage` | Edit a product |
| `POST` | `/admin/products/:id/archive` | Admin `catalog:manage` | Archive (keeps history and images) |
| `POST` | `/admin/products/:id/restore` | Admin `catalog:manage` | Un-archive |
| `DELETE` | `/admin/products/:id` | Admin `catalog:manage` | Permanently delete a never-ordered product |
| `POST` | `/admin/products/:id/variants` | Admin `catalog:manage` | Add a variant |
| `PUT` | `/admin/products/:id/variants/:variantId` | Admin `catalog:manage` | Edit a variant |
| `DELETE` | `/admin/products/:id/variants/:variantId` | Admin `catalog:manage` | Deactivate a variant |
| `POST` | `/admin/products/:id/images` | Admin `catalog:manage` | Attach an uploaded image |
| `PUT` | `/admin/products/:id/images/order` | Admin `catalog:manage` | Reorder images |
| `DELETE` | `/admin/products/:id/images/:mediaId` | Admin `catalog:manage` | Remove an image (also deleted from S3) |
| `POST` | `/admin/products/check-duplicate` | Admin `catalog:view` | Warn about a similar name or SKU |
| `GET` | `/admin/catalog/export` | Admin `catalog:manage` | CSV export (phase 3) |

### F05 · Warehouse Stock & Pricing

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/warehouses/:id/products` | Admin `warehouse_catalog:view` | List a warehouse's offerings |
| `POST` | `/admin/warehouse-products` | Admin `warehouse_catalog:manage` | Add a master product to a warehouse |
| `GET` | `/admin/warehouse-products/:id` | Admin `warehouse_catalog:view` | One offering |
| `PUT` | `/admin/warehouse-products/:id` | Admin `warehouse_catalog:manage` | Edit price, quantity, on/off |
| `POST` | `/admin/warehouse-products/bulk` | Admin `warehouse_catalog:manage` | Bulk edit many offerings |
| `POST` | `/admin/stock/adjust` | Admin `stock:manage` | Add or remove stock with a reason |
| `POST` | `/admin/stock/count` | Admin `stock:manage` | Stock-take: set counted quantities |
| `GET` | `/admin/stock/levels` | Admin `stock:view` | Levels, low-stock list |
| `GET` | `/admin/stock/movements` | Admin `stock:view` | Stock movement history |
| `GET` | `/admin/price-history` | Admin `stock:view` | Price change history |

### F06 · Product Import & Admin Product Tree

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/warehouses/:id/tree` | Admin `warehouse_catalog:view` | Category → product → variants tree for one warehouse |
| `POST` | `/admin/import/preview` | Admin `catalog:import` | Preview copying products from another warehouse |
| `POST` | `/admin/import/commit` | Admin `catalog:import` | Create the offerings from an edited preview |

### F07 · Notify Me (Back in Stock)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/notify-me` | Customer | Subscribe to a back-in-stock alert |
| `GET` | `/notify-me` | Customer | My active subscriptions |
| `DELETE` | `/notify-me/:id` | Customer | Cancel a subscription |
| `GET` | `/admin/notify-demand` | Admin `notify_demand:view` | Demand list for restocking |

### F08 · Discovery & Location

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

### F09 · Addresses

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/addresses` | Customer | My saved addresses |
| `POST` | `/addresses` | Customer | Save an address |
| `GET` | `/addresses/:id` | Customer | One address |
| `PUT` | `/addresses/:id` | Customer | Edit an address |
| `DELETE` | `/addresses/:id` | Customer | Delete an address (and its voice note and photo) |
| `POST` | `/addresses/:id/default` | Customer | Make it the default |

### F10 · Cart & Quote

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/cart` | Customer | Current server cart, priced |
| `PUT` | `/cart` | Customer | Sync the whole cart from the device |
| `POST` | `/cart/coupon` | Customer | Apply a coupon |
| `DELETE` | `/cart/coupon` | Customer | Remove the coupon |
| `POST` | `/quotes` | Customer | Create a quote (bill + ETA per delivery) |
| `GET` | `/quotes/:id` | Customer | Read a quote |

### F11 · Delivery Fees & Surcharges

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/delivery-rules` | Admin `delivery_rules:manage` | List fee and surcharge rules |
| `POST` | `/admin/delivery-rules` | Admin `delivery_rules:manage` | Create a rule |
| `GET` | `/admin/delivery-rules/:id` | Admin `delivery_rules:manage` | One rule |
| `PUT` | `/admin/delivery-rules/:id` | Admin `delivery_rules:manage` | Edit a rule |
| `DELETE` | `/admin/delivery-rules/:id` | Admin `delivery_rules:manage` | Deactivate a rule |
| `POST` | `/admin/delivery-rules/preview` | Admin `delivery_rules:manage` | Preview a full bill |
| `POST` | `/admin/ops/rain` | Admin `ops_mode:manage` | Switch rain mode (also in [F17](F17-hours-preorders-and-ops-mode.md)) |

### F12 · Coupons & Offers

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

### F13 · Order Placement & Split Orders

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/orders` | Customer | Place an order from a quote |
| `GET` | `/orders` | Customer | My order history (groups) |
| `GET` | `/order-groups/:id` | Customer | One group with all its children |
| `GET` | `/orders/:id` | Customer | One child order in detail |
| `POST` | `/orders/:id/reorder` | Customer | Put a past order's items back into the cart |

### F14 · Order Lifecycle & Packing

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/orders` | Admin `orders:view` | List and search orders |
| `GET` | `/admin/orders/changes` | Admin `orders:view` | Poll for new and changed orders (board, bell) |
| `GET` | `/admin/orders/:id` | Admin `orders:view` | Full order detail |
| `GET` | `/admin/order-groups/:id` | Admin `orders:view` | A group with all its children |
| `POST` | `/admin/orders/:id/confirm` | Admin `orders:manage` | Confirm (when auto-confirm is off) |
| `POST` | `/admin/orders/:id/start-packing` | Admin `orders:manage` | Start packing |
| `POST` | `/admin/orders/:id/items/:itemIndex/unavailable` | Admin `orders:manage` | Mark a line unavailable or reduce it 🔒 |
| `PUT` | `/admin/orders/:id/items/:itemIndex` | Admin `orders:manage` | Change a line's quantity before dispatch 🔒 |
| `POST` | `/admin/orders/:id/complete-packing` | Admin `orders:manage` | Packing done → READY |
| `POST` | `/admin/orders/:id/cancel` | Admin `orders:manage` | Cancel before pickup 🔒 |
| `POST` | `/admin/orders/:id/force-status` | Admin `orders:manage` | Force a status with a reason 🔒 |
| `POST` | `/admin/orders/:id/notes` | Admin `orders:manage` | Add an internal note |
| `GET` | `/admin/orders/:id/print` | Admin `orders:view` | Printable bill or packing slip |

### F15 · Payments

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/payments/verify` | Customer | Provisional check after Razorpay checkout |
| `POST` | `/payments/retry` | Customer | Start a new payment attempt before expiry |
| `GET` | `/order-groups/:id/payment` | Customer | Poll "confirming payment" status |
| `POST` | `/orders/:id/pay-link` | Customer | Pay a COD order online before cash is collected |
| `POST` | `/webhooks/razorpay` | Webhook | Razorpay events (authoritative) |
| `GET` | `/admin/payments` | Admin `payments:view` | List payments |
| `GET` | `/admin/payments/:id` | Admin `payments:view` | One payment |
| `POST` | `/admin/payments/reconcile` | Admin `payments:manage` | Compare Razorpay with our records |
| `GET` | `/admin/payments/reconciliation` | Admin `payments:view` | Latest reconciliation results |
| `POST` | `/admin/payments/:id/mark-paid` | Admin `payments:manage` | Mark a stuck payment paid 🔒 |

### F16 · Cancellations & Refunds

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/orders/:id/cancel` | Customer | Cancel my order (before packing starts) |
| `POST` | `/orders/:id/refund-request` | Customer | Ask for a refund (missing or damaged item) |
| `GET` | `/refunds` | Customer | My refunds |
| `GET` | `/refunds/:id` | Customer | One refund |
| `GET` | `/admin/refunds` | Admin `refunds:manage` | Pending and past refunds |
| `GET` | `/admin/refunds/:id` | Admin `refunds:manage` | One refund with photos |
| `POST` | `/admin/refunds` | Admin `refunds:manage` | Create a refund by hand 🔒 |
| `POST` | `/admin/refunds/:id/approve` | Admin `refunds:manage` | Approve a customer request 🔒 |
| `POST` | `/admin/refunds/:id/reject` | Admin `refunds:manage` | Reject with a reason 🔒 |
| `POST` | `/admin/refunds/:id/mark-done` | Admin `refunds:manage` | Record that it was paid 🔒 |

### F17 · Hours, Pre-orders & Ops Mode

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/preorder/slots` | Customer | Next-morning slots with remaining capacity |
| `PUT` | `/admin/warehouses/:id/hours` | Admin `warehouses:manage` | Opening hours and after-hours mode |
| `PUT` | `/admin/warehouses/:id/preorder` | Admin `warehouses:manage` | Pre-order slots and cutoff |
| `POST` | `/admin/ops/pause` | Admin `ops_mode:manage` | Pause orders for a zone or warehouse 🔒 |
| `POST` | `/admin/ops/resume` | Admin `ops_mode:manage` | End a pause 🔒 |
| `POST` | `/admin/ops/rain` | Admin `ops_mode:manage` | Rain mode (see [F11](F11-delivery-fees-and-surcharges.md)) ↗ F11 |
| `GET` | `/admin/preorders` | Admin `orders:view` | Pre-orders waiting for their slot |

### F18 · Dispatch, Assignment & Handover

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/dispatch/suggestions` | Admin `dispatch:manage` | Ranked eligible riders for an order |
| `POST` | `/admin/orders/:id/assign` | Admin `dispatch:manage` | Assign an order to a rider 🔒 |
| `POST` | `/admin/orders/:id/unassign` | Admin `dispatch:manage` | Take it back (before pickup) 🔒 |
| `POST` | `/admin/order-groups/:id/dispatch` | Admin `dispatch:manage` | Dispatch a split order: same or different riders 🔒 |
| `POST` | `/admin/batches` | Admin `dispatch:manage` | Build a batch of stops for one rider |
| `GET` | `/admin/batches` | Admin `dispatch:manage` | List batches |
| `PUT` | `/admin/batches/:id` | Admin `dispatch:manage` | Reorder stops or add/remove orders |
| `POST` | `/admin/batches/:id/cancel` | Admin `dispatch:manage` | Cancel a batch that has not started |
| `POST` | `/admin/orders/:id/handover` | Admin `dispatch:manage` | Hand a picked-up order to another rider 🔒 |
| `POST` | `/admin/orders/:id/failed/resolve` | Admin `orders:manage` | Resolve a failed delivery 🔒 |
| `GET` | `/admin/assignments` | Admin `dispatch:manage` | Assignments with acknowledgement status |
| `GET` | `/admin/dispatch/alerts` | Admin `dispatch:manage` | Unacknowledged, delayed, offline, rider-reported problems |
| `GET` | `/admin/riders/live` | Admin `dispatch:manage` | Rider positions and loads for the map |

### F19 · Rider App

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/rider/me` | Rider | Profile, status, current shift and warehouse |
| `POST` | `/rider/shift/start` | Rider | Punch in and go online |
| `POST` | `/rider/shift/switch-warehouse` | Rider | Change current warehouse mid-shift |
| `POST` | `/rider/shift/break` | Rider | Go on break |
| `POST` | `/rider/shift/resume` | Rider | Come back from break |
| `POST` | `/rider/shift/end` | Rider | Punch out |
| `GET` | `/rider/assignments` | Rider | My assignments (poll with `since`) |
| `POST` | `/rider/assignments/:id/ack` | Rider | Acknowledge an assignment |
| `GET` | `/rider/orders/:id` | Rider | Order detail for delivery |
| `POST` | `/rider/orders/:id/pickup` | Rider | Picked up at the warehouse |
| `POST` | `/rider/orders/:id/start-ride` | Rider | Start the ride |
| `POST` | `/rider/orders/:id/arrived` | Rider | Arrived at the door |
| `POST` | `/rider/orders/:id/verify-otp` | Rider | Check the customer's delivery OTP |
| `POST` | `/rider/orders/:id/deliver` | Rider | Mark delivered |
| `POST` | `/rider/orders/:id/failed` | Rider | Report a failed delivery |
| `POST` | `/rider/orders/:id/problem` | Rider | Report a problem to the admin |
| `GET` | `/rider/history` | Rider | My delivery history |
| `PUT` | `/rider/profile/photo` | Rider | Set my profile photo |
| `GET` | `/admin/riders` | Admin `riders:view` | List riders |
| `POST` | `/admin/riders` | Admin `riders:manage` | Pre-register a rider 🔒 |
| `GET` | `/admin/riders/:id` | Admin `riders:view` | One rider |
| `PUT` | `/admin/riders/:id` | Admin `riders:manage` | Edit name, zone, allowed warehouses 🔒 |
| `POST` | `/admin/riders/:id/deactivate` | Admin `riders:manage` | Deactivate and revoke sessions 🔒 |
| `POST` | `/admin/riders/:id/reactivate` | Admin `riders:manage` | Reactivate 🔒 |
| `POST` | `/admin/riders/:id/force-offline` | Admin `riders:manage` | End the rider's shift 🔒 |
| `GET` | `/admin/riders/:id/shifts` | Admin `riders:view` | A rider's shifts |
| `GET` | `/admin/shifts` | Admin `riders:view` | Attendance across riders |

### F20 · ETA & Live Tracking

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/orders/:id/tracking` | Customer | Status, ETA and rider position for one child order |
| `GET` | `/track/:token` | Token link | Public tracking page data (no login) |
| `POST` | `/rider/location` | Rider | Send location pings |

### F21 · Offline-First & Low Network

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/rider/orders/:id/bundle` | Rider | Download everything needed to deliver offline |
| `POST` | `/rider/sync` | Rider | Upload the offline event queue in order |
| `GET` | `/admin/offline-reviews` | Admin `orders:manage` | Offline deliveries waiting for review |
| `POST` | `/admin/offline-reviews/:orderId/resolve` | Admin `orders:manage` | Close a review 🔒 |

### F22 · Rider Cash & Settlement

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/rider/cash` | Rider | My cash in hand and today's entries |
| `POST` | `/rider/orders/:id/collect-cash` | Rider | Record cash collected for an order |
| `POST` | `/rider/orders/:id/collect-upi` | Rider | Record a doorstep UPI payment (unverified) |
| `GET` | `/admin/cash/riders` | Admin `cash:manage` | Cash in hand per rider and warehouse |
| `GET` | `/admin/cash/ledger` | Admin `cash:manage` | Ledger entries |
| `POST` | `/admin/cash/deposit` | Admin `cash:manage` | Record a deposit 🔒 |
| `POST` | `/admin/cash/adjust` | Admin `cash:manage` | Adjustment entry with a reason 🔒 |
| `GET` | `/admin/reconciliation` | Admin `cash:manage` | Items needing review |
| `POST` | `/admin/reconciliation/:id/resolve` | Admin `cash:manage` | Resolve a reconciliation item 🔒 |
| `POST` | `/admin/orders/:id/fix-collection` | Admin `orders:manage` | Correct a wrong collection record 🔒 |

### F23 · Notifications

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/me/notification-prefs` | Customer | My promo preferences |
| `PUT` | `/me/notification-prefs` | Customer | Change promo preferences |
| `GET` | `/admin/notification-templates` | Admin `notifications:manage` | List templates |
| `POST` | `/admin/notification-templates` | Admin `notifications:manage` | Create a template 🔒 |
| `PUT` | `/admin/notification-templates/:id` | Admin `notifications:manage` | Edit a template 🔒 |
| `GET` | `/admin/notifications` | Admin `notifications:manage` | Delivery log |
| `POST` | `/admin/notifications/:id/retry` | Admin `notifications:manage` | Retry a failed message |
| `POST` | `/admin/broadcast` | Admin `notifications:manage` | Send a promo broadcast 🔒 |
| `GET` | `/webhooks/whatsapp` | Webhook | Provider verification challenge |
| `POST` | `/webhooks/whatsapp` | Webhook | Delivery status and incoming replies |

### F24 · Media Storage (S3)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/media/upload-url` | Auth | Get a presigned upload for one file |
| `POST` | `/media/complete` | Auth | Tell the server the upload finished |
| `GET` | `/media/:id` | Auth | Status and URLs of a file |
| `GET` | `/media/:id/url` | Auth | Short-lived signed URL for a private file |
| `DELETE` | `/media/:id` | Auth | Delete my file |
| `GET` | `/admin/media/failed` | Admin `catalog:manage` | Files whose deletion failed |
| `POST` | `/admin/media/:id/retry-delete` | Admin `catalog:manage` | Retry a failed deletion |

### F25 · Admin Panel, Settings & Reports

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

## How the apps use this folder

- **Customer app:** F01 login, F03 location, F08 browse, F09 addresses, F10 cart and quote, F13 place order, F15 payments, F16 cancel and refund, F20 tracking, F07 Notify Me, F12 coupons, F17 pre-orders, F23 push payloads, F24 uploads.
- **Rider app:** F01 login (`app: "rider"`), F19 shifts and delivery, F20 location, F21 bundle and offline sync, F22 cash, F23 push payloads, F24 uploads.
- **Web admin:** every `/admin/*` endpoint, grouped by feature as in the table above.
- **Backend:** build each feature's endpoints in the order of the backend plan; the response examples are the contract the apps compare against.
