# Darjeeling Stores – Quick Commerce: Architecture & Product Plan

Date: 2026-11-03 · Status: draft v2 (stack finalized: Express + MongoDB, no Redis, polling tracking)

## 1. Goals, scale, and what we sell

**Scale (launch):** ~50 orders/day, 6 delivery partners, one store, one city/zone.
**Implication:** no microservices. One Express backend (modular monolith), one MongoDB, one small server. Keep module boundaries clean so we can split later.

**What we sell: groceries + vegetables (+ fruits, dairy, staples, household).** Good fit for quick commerce (repeat purchase, small baskets).

- **Loose items (veggies/fruit)** are sold as **fixed-size variants**: 250 g / 500 g / 1 kg, each with a fixed price. Customer uses + / − on a variant. No weight adjustment at packing, so the bill is exact at checkout (COD and Razorpay amounts never change).
- **Packaged items** are by unit with variants (e.g. 500 g / 1 kg pack).
- **Out-of-stock at packing time:** admin/picker marks item unavailable → customer notified, bill recalculated, partial refund if prepaid.
- **Perishables:** optional expiry/batch per product (phase 3).
- **Compliance (India):** FSSAI licence; GST per product (`gstRate`, `hsnCode`); confirm rates with a CA.
- **Pricing:** MRP, selling price, optional sale price with date range.

## 2. System overview

```
 Customer mobile app ─┐
 Customer web (phone- ├──► REST API (Express) ──► MongoDB (2dsphere for zones)
   width storefront)  │         │
 Admin panel (web) ───┤         ├──► Razorpay (orders, webhooks, refunds)
 Delivery partner app ┘         ├──► FCM push
                                ├──► WhatsApp Business Cloud API
                                ├──► SMS/OTP provider
                                ├──► Google Maps Platform
                                └──► Cloudinary (images)
   Tracking: HTTP polling (no sockets, no Redis)
```

### Stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Backend | **Node.js + Express** (TypeScript recommended) + Mongoose + Zod | Modular monolith, single instance |
| DB | **MongoDB** (Atlas, replica set) | `2dsphere` index + `$geoIntersects` for delivery zone check; atomic `updateOne` with `$gte` guard for stock; amounts stored as integer paise |
| Cache / queue | **None (no Redis)** | See §2.1 for replacements |
| Tracking | **HTTP polling** | See §6 |
| Web | **Next.js** – `/` storefront (max-width ~480px centered, "Download App" banner), `/admin` panel | Shared API client |
| Mobile | **React Native (Expo)** – Customer app + Delivery app | Expo dev build (not Expo Go) for background location |
| Maps | **Google Maps Platform** (Maps SDK, Places, Geocoding, Routes) | Restrict keys per app/domain; budget alerts |
| Images | **Cloudinary** | Signed uploads from admin; store `public_id`, serve with `f_auto,q_auto` + width |
| Infra | Docker, 1 VPS (or Render/Railway) + MongoDB Atlas, Sentry | Cheap, enough for 50 orders/day |

Monorepo:
```
apps/api  apps/web  apps/customer-app  apps/delivery-app
packages/shared (types, zod schemas, api client, constants)
docs/
```

### 2.1 Without Redis

| Need | Replacement |
|---|---|
| OTP storage | `otps` collection with TTL index |
| Rate limiting | `express-rate-limit` (in-memory store) |
| Settings cache | In-memory, refreshed when admin saves settings |
| Job queue (notifications, retries, payment reconciliation) | `jobs` collection + worker polling every few seconds (Agenda or small custom worker) |
| Auto-assign offer timeouts | Persist `offerExpiresAt` in Mongo; sweeper runs every ~10 s so offers survive restarts |
| Sockets | Not used |

**Rule:** run a **single API instance** (in-memory cache/rate limits assume it). If we ever scale to several instances, add Redis then.

## 3. Authentication – phone + OTP

- Customer: phone → OTP (SMS via MSG91/Twilio, or WhatsApp OTP) → short-lived JWT + refresh token. Rate-limit per phone/IP, 5-min expiry, max attempts.
- Delivery partner: phone + OTP, only if pre-registered by admin (invite-only).
- Admin: **email + password + optional 2FA** (roles: super admin, manager, picker/ops).
- Name + default address captured after first login.
- Phones stored in E.164, unique index.

## 4. Catalog, stock, price, discounts

- **Entities:** Category (tree) → Product → embedded `variants[]` → Cloudinary images.
- **Variant:** `{ label: "250 g", weightGrams, price, mrp, sku, stock? }`.
- **Stock modes (`stockMode` on product):**
  - `pooled_weight` (loose veggies/fruit): one stock number in **grams** on the product; each variant deducts its `weightGrams × qty`. Prevents 250 g / 500 g / 1 kg counts drifting apart.
  - `per_variant` (packaged): stock count on each variant.
- **Stock updates:** atomic `updateOne({ _id, stock: { $gte: need } }, { $inc: { stock: -need } })` at order placement (reserve); restore on cancel/payment-expiry. `stock_movements` collection logs every change with reason. Low-stock alerts.
- **Cart UX:** pick variant, then + / − changes quantity (2 × 500 g); "change size" chip switches between sizes. Max qty per item is an admin setting.
- **Price management:** edit single/bulk (CSV import/export), scheduled sale price, price history.
- **Discounts:** coupons (percent/flat, min order, max discount, per-user limit, first-order only, validity), product/category offers, free-delivery threshold. One `pricing` module computes the bill on the server; clients never compute totals.
- **Bill:** items subtotal, discount, delivery fee, handling/small-order fee, tax, total – all driven by admin settings.

## 5. Orders & payments (COD + UPI/Razorpay)

### Order state machine
`PLACED → CONFIRMED → PACKING → READY → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED`
Side exits: `CANCELLED`, `FAILED_DELIVERY`, `REFUNDED` (partial/full).
Each transition is logged in `order_events` (who, when) → drives the tracking timeline and notifications.

### Payments
| Method | Flow |
|---|---|
| **UPI/online (Razorpay)** | Server creates our order + Razorpay order (paise) → client opens Razorpay checkout → server verifies signature **and** treats the **webhook** (`payment.captured` / `payment.failed`) as the source of truth → order CONFIRMED only when paid. Unpaid orders expire after N minutes (setting) and restore stock. |
| **COD** | CONFIRMED immediately (subject to admin-set COD cap / zone rules). Rider collects cash and marks "cash collected"; admin reconciles rider cash daily (cash ledger). |

Rules:
- Idempotency keys on order creation and webhook handling (Razorpay retries).
- Never trust client-side payment success.
- Fixed-price variants → no weight-based bill changes. Refunds only for cancellations / unavailable items.
- **Refunds are manual (v1):** admin pays the refund outside the system (Razorpay dashboard for online orders; UPI/cash for COD), then clicks **Mark refund done** in the panel. Refund record: `orderId`, `paymentId?`, `amount`, `reason` (cancelled / item unavailable / other), `status` (`requested` → `done`), `method` (razorpay / upi / cash), `reference`, `note`, `markedBy`, `markedAt`. Admin has a "Pending refunds" list; marking done notifies the customer (push + WhatsApp). A "Refund via Razorpay" API button can be added later without data-model change.
- Daily reconciliation job: Razorpay payments vs our DB.
- Order-level `refundStatus` (none / pending / done) is shown on the order screen.

## 6. Delivery zones, assignment, tracking

### Service area
- Admin draws **polygon zone(s)** on Google Maps; stored as GeoJSON with a `2dsphere` index. Checkout checks the customer's pin with `$geoIntersects`. Outside zone → "we don't deliver here yet" (optional waitlist).
- Zone config (admin): delivery fee, min order, free-delivery threshold, open hours, enabled/disabled. Start with 1 zone.
- Address entry: map pin + Places autocomplete + house/landmark, saved addresses.

### Rider assignment – hybrid
1. **Setting:** `assignmentMode = manual | auto | auto_with_fallback` (default `auto_with_fallback`).
2. **Auto:** when order is READY, pick riders who are online and under `maxActiveOrders`; score by distance to store, current load, fairness. Send an offer; rider must accept within X seconds (setting) or it goes to the next rider. If nobody accepts → admin alert.
3. **Manual:** admin dispatch board can assign/reassign any order; override always wins.
4. Riders are salaried: no payout logic, only shifts/attendance, cash ledger, delivery counts.

### Live tracking – polling
- **Rider app** POSTs location every ~10 s, only while it has an active order (Android foreground service + battery-optimization prompt).
- **Backend** saves latest position on the rider document (optional trail with TTL index).
- **Customer app/web** polls one endpoint, `GET /orders/:id/tracking` (status + rider position + ETA):
  - ~5 s while OUT_FOR_DELIVERY, ~15–30 s before that
  - only while the tracking screen is open and the order is active; stop on DELIVERED or app background
  - animate the marker between points on the client
- **Admin dispatch board** polls every ~10 s.
- Push notifications cover key status changes when the app is closed.
- Optional **delivery OTP** at the doorstep (setting) to prevent false "delivered".
- Sockets can be added later without data-model changes.

## 7. Notifications

- **Push (FCM):** order status, rider new-order offers, promos.
- **WhatsApp Business Cloud API:** order confirmation, out-for-delivery + tracking link, receipt (approved templates; key transactional messages only; reaches web-only users).
- **SMS:** OTP fallback.
- **WhatsApp setup checklist:** Meta Business account verified · WhatsApp Business Cloud API app · dedicated number not active on the WhatsApp app (or migrated) · submit templates in Phase 1 so they are approved by Phase 2: order confirmed, out for delivery (with tracking link), delivered, refund done. Push + SMS cover until approval.
- `notification` module with channel adapters, templates, retries, per-user preferences and a delivery log; run through the Mongo-backed jobs collection. Order state changes emit events that trigger notifications – no ad-hoc calls scattered in code.

## 8. Admin panel & settings

Modules: Dashboard · Orders · Dispatch board · Catalog (categories, products, variants, bulk import) · Inventory · Pricing & coupons · Customers · Riders (onboarding, shifts, cash ledger) · Zones (map editor) · Notification templates · Payments & refunds · Reports (sales, COD cash, deliveries) · Roles & audit log · **Settings**.

**All business settings live in a `settings` collection, editable in the admin panel (validated, audited, no redeploy):**

| Group | Settings |
|---|---|
| Store | name, logo, contact, open/close hours, "pause orders" switch, FSSAI/GST no. |
| Delivery | zones, **fee mode** (`flat` / `distance` = base fee for first X km + per-km rate via Google Routes; optional `free above threshold` on top of either), min order, small-order fee, prep time + ETA buffer, handling fee, max items. Launch default: `flat` + free-above-threshold |
| Assignment | mode, offer timeout, max active orders per rider, batching on/off |
| Payments | enable COD / online, COD max amount, COD per zone, order-expiry minutes, **refund policy**: post-delivery refund window (hours), eligible reasons/categories (e.g. perishables), photo proof required on/off, auto-reject after window |
| Discounts | coupon rules, first-order offer |
| Stock | low-stock threshold, reservation timeout, show out-of-stock items, max qty per item |
| Notifications | channel toggles, templates, quiet hours |
| Auth | OTP length/expiry/attempts, delivery-OTP on/off |
| App | min supported app version (force update), "Download App" link, banners, support number |
| Tax | GST rates, price inclusive/exclusive |

Only secrets (Razorpay, WhatsApp, Google, Cloudinary, SMS keys) stay in env, never in the DB.

## 9. Data model (collections)

`users` · `addresses` · `categories` · `products` (embedded `variants`) · `stock_movements` · `price_history` · `coupons` · `carts` · `orders` (embedded items snapshot) · `order_events` · `payments` · `refunds` (manual, see §5) · `riders` (latest location) · `rider_shifts` · `assignments` · `cash_ledger` · `zones` (GeoJSON) · `settings` · `notifications` · `jobs` · `otps` (TTL) · `audit_log`

All collections carry `storeId` for future multi-store. Money in integer paise.

## 10. Phased roadmap

1. **Phase 0 – Foundations (1 wk):** monorepo, Express skeleton, Mongo, OTP auth, settings module, CI, deploy.
2. **Phase 1 – Core MVP (3–4 wks):** catalog + variants + stock, cart/checkout, zone check, COD + Razorpay, admin orders + manual assignment, delivery app (accept, status, location), push.
3. **Phase 2 – Quick-commerce features (2–3 wks):** polling tracking UI, auto-assign hybrid, coupons, WhatsApp, delivery OTP, cash ledger, reports.
4. **Phase 3 – Polish:** bulk import, batching, substitutions, analytics, expiry/batch tracking.

## 11. Decisions log

| # | Decision |
|---|---|
| 1 | Single store (`storeId` kept for later) |
| 2 | Riders salaried – no payout engine |
| 3 | Quick delivery only – no slots |
| 4 | All settings editable in the admin panel |
| 5 | Google Maps |
| 6 | React Native (Expo) for both apps |
| 7 | Express + MongoDB backend, Next.js web |
| 8 | No Redis (Mongo TTL/jobs, in-memory cache, single instance) |
| 9 | Tracking by HTTP polling, no Socket.IO |
| 10 | Cloudinary for images |
| 11 | Loose items sold as fixed variants (250 g / 500 g / 1 kg) with pooled gram stock |
| 12 | Delivery fee mode (flat / distance / free-above) is an admin setting; launch with flat + free-above |
| 13 | Refunds are manual with a "Mark refund done" action (no refund API in v1); refund window/conditions are admin settings |
| 14 | WhatsApp number and Meta Business account are ready; submit templates in Phase 1 |

## 12. Risks and open questions

**Risks**
- Razorpay webhooks lost/duplicated → idempotency + reconciliation job.
- Android kills background rider app → foreground service, onboarding checks.
- Physical vs system stock mismatch → daily stock-count tool + audit log.
- WhatsApp template approval delay → apply early.
- Play Store / App Store review time → start early; web storefront can launch first.
- In-memory state breaks with multiple API instances → keep one instance (or add Redis).

**Open questions**
1. Hosting/budget and domain?

Resolved: refund window/conditions are admin settings (see §8); WhatsApp number and Meta Business account are ready.
