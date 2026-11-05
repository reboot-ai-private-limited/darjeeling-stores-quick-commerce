# Darjeeling Stores – Quick Commerce: Architecture & Product Plan

Date: 2026-11-05 · Status: draft v3 (multi-warehouse, zone-based catalog, split orders, admin-only dispatch, settings-driven fees)

Related docs: `docs/01-roles-and-actions.md` · `docs/02-workflows.md` · `docs/03-erd.md` · `docs/04-delivery-config.md` · `docs/05-offline-and-low-network.md` · `docs/06-media-storage.md`

## 1. Goals, scale, and what we sell

**Launch scale:** ~50 orders/day, 6 in-house salaried riders, 1 zone, 1–2 warehouses.
**Data model scale:** many cities → many zones → many warehouses from day one (cheap now, painful to retrofit).
**Implication:** no microservices. One Express backend (modular monolith), one MongoDB, one small server, one API instance. Keep module boundaries clean.

**What we sell:** groceries + vegetables (+ fruits, dairy, staples, household). Single vendor (the owner); `vendorId` exists on products/warehouses and defaults to the owner so a marketplace can be added in Phase 2.

- **Loose items** are sold as **fixed-size variants** (250 g / 500 g / 1 kg), each with a fixed price. The bill is exact at checkout.
- **Packaged items** are by unit with variants.
- **Out of stock at packing:** warehouse staff mark the line unavailable → bill recalculated (delivery fee never rises) → customer notified → partial refund if prepaid.
- **Compliance (India):** FSSAI licence; GST per product (`gstRate`, `hsnCode`); confirm GST on delivery fees/surcharges and per-warehouse invoicing with a CA.

## 2. System overview

```
 Customer app (RN) ─┐
 Next.js web         ├──► REST API (Express, 1 instance) ──► MongoDB (2dsphere)
  (storefront+admin)┤         │
 Rider app (RN, Android)      ├──► Razorpay (orders, webhooks, payment links)
                              ├──► FCM + Notifee (push, rider alarm)
                              ├──► WhatsApp Business API provider (W-Agent)
                              ├──► SMS/OTP provider (fallback)
                              ├──► Google Maps Platform (Maps, Places, Routes)
                              └──► AWS S3 + CloudFront (images, voice notes, photos)
```

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | **Node.js + Express** (TypeScript) + Mongoose + Zod | Modular monolith, single instance |
| DB | **MongoDB** (Atlas, replica set) | `2dsphere` for zone checks; atomic `updateOne` with `$gte` guard for stock; money in integer paise |
| Cache / queue | **None (no Redis)** | See §2.1 |
| Live updates | **HTTP polling everywhere (no sockets)** + FCM push for events when the app is closed | Customer ~10 s while out for delivery; admin board ~5 s; rider app ~15 s in foreground. Polling is forgiving on weak hill networks |
| Web (all of it) | **Next.js (App Router)**, one app: public storefront at `/` and admin panel at `/admin` | No separate React/Vite app. Admin pages are client components that poll; storefront is phone-width with a "Download App" banner (Phase 2) |
| Mobile | **React Native (Expo dev build)** – Customer (Android+iOS) and Rider (Android only) | FlashList, MMKV, `expo-image` (or FastImage if still maintained), `expo-haptics`, Notifee |
| Maps | Google Maps Platform | Restrict keys; cache ETA calls per (address, warehouse); budget alerts |
| Files | **AWS S3** (+ CloudFront for public images) | Direct uploads via presigned URLs; server makes WebP sizes (`sharp`), product card image ≤ 30 KB; every file tracked in `media_files`; deleted from S3 when removed; voice notes auto-deleted 7 days after delivery. See `docs/06-media-storage.md` |
| Infra | Docker, 1 VPS (or Render/Railway) + Atlas, Sentry | |

Monorepo: `apps/api  apps/web (Next.js: storefront + /admin)  apps/customer-app  apps/rider-app  packages/shared  docs/`

### 2.1 Without Redis

| Need | Replacement |
|---|---|
| OTP storage | `otps` collection, TTL index |
| Rate limiting | `express-rate-limit` (in-memory) |
| Settings cache | In-memory, refreshed on admin save |
| Job queue | `jobs` collection + worker polling every few seconds |
| Assignment acknowledgement timeouts | Persist `ackDeadlineAt`; sweeper every ~10 s |
| Sockets | Not used; polling "changes" endpoints with a `since` cursor (see §8) |

**Rule:** one API instance (in-memory cache/rate limits assume it). If we ever scale out, add Redis then.

## 3. Geography model: City → Zone → Warehouse

```
City (label, locality dropdown)
 └─ Zone (GeoJSON polygon; delivery rules; riders belong to one zone)
     └─ Warehouse 1..N (belongs to exactly ONE zone; own catalog rows, stock, prices, hours, pack time)
```

- **A zone has many warehouses; a warehouse belongs to one zone.** Zones must not overlap (admin map editor rejects overlaps).
- **A rider belongs to one zone** and may work from several of that zone's warehouses (`warehouseIds[]`).
- **Customer location → zone** (`$geoIntersects`) → **catalog = the zone's warehouses combined**. Products, prices, stock and ETA all depend on the zone.
- **Same product in several warehouses of one zone:** allowed (stock is per warehouse) but the selling price must be identical across them – setting `zonePriceConflictMode = block | warn` (default `block`). So the customer sees one price per product.
- **No stock transfers between warehouses.** Each warehouse's quantity is its own count.
- Outside every zone → "Coming soon" + waitlist.

## 4. Authentication

- Customer: phone → OTP, **WhatsApp primary, SMS fallback**. Login OTP is **6 digits** (4 digits is too guessable); strict attempt lockout. The **delivery OTP is 4 digits** (separate, per order group).
- Rider: phone + OTP, only if pre-registered. Admin: email + password + optional 2FA.
- Name + default address captured after first login. Phones in E.164, unique.
- Auto-read of WhatsApp OTP depends on the provider's autofill template; verify before promising it. SMS uses the SMS Retriever API.

## 5. Catalog, warehouses, stock, price

- **Master catalog** (global): Category tree → Product → embedded `variants[]` (label, weightGrams, sku) → images. No price or stock here.
- **Warehouse offering** (`warehouse_products`): per (warehouse, product) holds status, stock and per-variant price/MRP/sale price/qty. Everything customers pay is read from here.
- **Stock modes:** `pooled_weight` (loose: one gram pool per warehouse, each variant deducts `weightGrams × qty`) and `per_variant` (packaged).
- **Atomic stock:** `updateOne({ warehouseId, productId, stock: { $gte: need } }, { $inc: ... })` at order placement; restore on cancel/expiry; `stock_movements` logs everything.
- **Import from another warehouse:** copies product link, variants, images, price, MRP, quantity into the target warehouse – all editable in a preview before saving; one product or bulk; the source is not changed and not kept in sync. Same-zone price rule is checked. See `02-workflows.md` §20.
- **Admin product tree:** pick a warehouse → Category → Product → Variants, with inline edit of price and quantity (and bulk edit). All edits logged (`price_history`, `stock_movements`, audit).
- **Notify Me:** out-of-stock items let customers subscribe (per zone); when any warehouse in the zone goes 0 → >0, push + WhatsApp. Admin sees a demand list.
- **Delta sync:** every offering row has a monotonic `rev`; apps fetch only changes since their last `rev` per zone (see `05`).

## 6. Pricing, fees, ETA (summary – details in `04-delivery-config.md`)

- One server `pricing` module; clients never compute totals. A **quote** (valid ~5 min) locks bill and ETA; placing an order requires a valid quote.
- Delivery fee comes from a **zone rules engine** (fee by order amount, always-free areas, min order), plus **surcharges** (rain mode, late-night window), small-order and handling fees – all admin settings, no deploy.
- **ETA = pack time + rider-arrival time + travel time + extra minutes (rain/night).** Pack and rider-arrival ("grace") times are per-warehouse settings; travel comes from Google Routes (cached per address+warehouse) with a locality/warehouse default fallback.
- **After hours:** per-warehouse hours; outside hours the warehouse is `closed` or `pre_order` (next-morning windows). Late-night delivery = extend hours + a night fee rule.

## 7. Orders & payments

### Order group and child orders
A checkout creates one **order group** (one payment, one bill, one delivery OTP, one delivery fee). The system **allocates** cart lines to warehouses in the zone; if one warehouse can't supply everything, the group splits into **child orders, one per warehouse**. The customer sees them as separate orders (own ETA, own tracking) linked together. Price and delivery charge are computed once for the group. See `02` §6.

### Child order state machine
`PENDING_PAYMENT → PLACED → CONFIRMED → PACKING → READY → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → ARRIVED → DELIVERED`
Exits: `CANCELLED`, `FAILED_DELIVERY` (→ `READY` or `CANCELLED`). Pre-orders are normal orders with `scheduledWindow`. `REFUNDED` is **not** a state – refunds are records. Full diagram in `02` §2 (the master).

### Payments
| Method | Flow |
|---|---|
| **UPI/online (Razorpay)** | Group + Razorpay order → client checkout → server verifies signature, **webhook is source of truth** → children move to `PLACED` only when paid. Unpaid expires after N min, stock restored. |
| **COD** | Children `PLACED` immediately (subject to COD cap/rules). Each child has an `amountDue`. Rider collects cash (or UPI QR) and marks collected; admin reconciles daily. |
| **Pay-online link for COD** | Customer can switch a COD group to paid via Razorpay link before cash is collected; rider app is told "do not collect". See `02` §12. |
| **UPI QR at doorstep** | Rider app builds a `upi://pay` QR locally; marked `upi_unverified` until admin reconciles with the bank (see `05`). |

Rules: idempotency keys on order creation and webhooks; never trust client payment success; **refunds are manual in v1** ("Mark refund done"); daily reconciliation job.

## 8. Dispatch, riders, tracking

- **Assignment is by admin/store manager. Riders cannot reject.** Modes: `manual` (default; board shows a suggested rider) or `auto` (system assigns without any offer). A rider must **acknowledge** an assignment (loud full-screen alarm); no ack in 2 min → WhatsApp to rider + admin alert.
- **Batching:** a batch holds up to `maxActiveOrders` (default 2, max 3). For a split order the admin chooses **same rider (one batch: pickup at warehouse A, pickup at B, one drop)** or **different riders**. Any batch may include pickups from several warehouses of the zone.
- **Rider shift:** geo-tagged punch-in at a warehouse; the rider picks a current warehouse and can switch mid-shift; admin can override.
- **Live tracking:** rider posts location every ~10 s on an order, ~60 s when idle online; customer polls `GET /orders/:id/tracking` (~10 s while out for delivery); shows "updated X ago"; location visible only after pickup. WhatsApp tracking link uses an expiring token (no login).
- **Admin panel:** polls `GET /admin/orders/changes?since=<cursor>` (~5 s) for the new-order bell, dispatch board and ack status; the bell sound needs one click ("Enable sound") because of browser autoplay rules. A new-order WhatsApp/push to the manager covers a closed tab.
- **Rider app:** FCM high-priority message wakes the app and raises the alarm; while open it polls `GET /rider/assignments?since=` (~15 s) and syncs its outbox.
- **Delivery OTP (4-digit)** per group; works offline in the rider app (`05`).
- **Cash:** ledger entries carry the order's `warehouseId`; admin settles per warehouse.

## 9. Offline-first & low network
Full design in `docs/05-offline-and-low-network.md`: MMKV catalog cache + delta sync, optimistic cart, idempotent checkout, offline rider bundle with OTP check, `DELIVERED` with `deliveredOffline` flag and sync queue, local UPI QR, hill address system (locality dropdown, mandatory landmark, voice note/photo).

## 10. Notifications

Dual channel for reliability: **FCM push + WhatsApp (W-Agent)**; SMS for OTP fallback. Matrix in `02` §18. Includes Notify Me, abandoned cart (opt-in, WhatsApp marketing template – optional), 8 PM owner digest, unacknowledged-assignment fallback. Everything through the Mongo `jobs` queue with retries and a delivery log. WhatsApp: submit templates in Phase 1.

## 11. Admin panel & settings

Modules: Dashboard (all or per warehouse) · Orders · Dispatch board (batches, split-order options) · Catalog (master) · **Warehouse products tree + Import** · Inventory · Pricing & coupons · Customers · Riders (zone, warehouses, shifts, cash) · Zones (map editor) · Warehouses · Delivery rules & ops mode (rain) · Localities · Notify-Me demand · Notification templates · Payments & refunds · Reports · Roles & audit · **Settings**.

**Settings** live in a `settings` collection with **scope resolution: warehouse → zone → global** (most specific wins). Validated, versioned, audited, no redeploy. Fee, hour, timer, pre-order, COD and assignment values in these docs are **placeholders** until you enter real numbers. Groups: store, delivery, eta, hours/afterHours/preOrder, assignment, payments, discounts, stock, orders, media, notifications, auth, app, tax. Only secrets (Razorpay, WhatsApp, Google, AWS/S3, SMS keys, UPI VPA) stay in env/config, never editable in the panel (VPA is stored on the warehouse record and audited).

## 12. Collections

`cities` · `localities` · `zones` · `warehouses` · `media_files` · `users` · `roles` · `addresses` · `categories` · `products` (master) · `warehouse_products` · `stock_movements` · `price_history` · `stock_subscriptions` · `coupons` · `carts` · `quotes` · `delivery_rules` · `order_groups` · `orders` · `order_events` · `payments` · `refunds` · `riders` · `rider_shifts` · `delivery_batches` · `assignments` · `offline_events` · `cash_ledger` · `settings` · `settings_history` · `notifications` · `notification_templates` · `jobs` · `otps` · `counters` · `audit_log` · `banners` · `waitlist`

Money in integer paise. Operational documents carry `zoneId` and/or `warehouseId`.

## 13. Phased roadmap

1. **Phase 0 – Foundations (1 wk):** monorepo, Express skeleton, Mongo, OTP auth, settings with scope resolution, CI, deploy.
2. **Phase 1 – Core MVP (4–5 wks):** cities/zones/warehouses, master catalog + warehouse offerings + admin tree + import, zone-based browse, cart + quote + fee rules (amount tiers, free zones, min order), COD + Razorpay, order group/split allocation, admin orders + manual dispatch + batches, rider app (shift, ack alarm, pickup, ride, OTP, cash), push, WhatsApp templates submitted.
3. **Phase 2 – Quick-commerce features (3 wks):** ETA (Routes), rain mode + night fee, tracking map + public link, offline rider bundle/sync + local UPI QR, Notify Me, pre-orders, delta sync, WhatsApp flows, coupons, owner digest, reports.
4. **Phase 3 – Polish:** abandoned-cart nudge, substitutions, ratings, bulk CSV, analytics, expiry/batch tracking, route ordering for multi-stop batches.

## 14. Decisions log

| # | Decision | Status |
|---|---|---|
| 1 | ~~Single store~~ → **Multi-warehouse**, City → Zone → Warehouse | Changed |
| 2 | Riders salaried – no payout engine | Kept |
| 3 | ~~Quick delivery only, no slots~~ → quick delivery + optional **next-morning pre-order windows** when closed | Changed |
| 4 | All settings editable in admin panel, with warehouse/zone/global scope | Extended |
| 5 | Google Maps | Kept |
| 6 | React Native (Expo) for both apps | Kept |
| 7 | Express + MongoDB backend; **all web (storefront + admin) in Next.js**, no separate React app | Updated |
| 8 | No Redis (single instance) | Kept |
| 9 | **Polling only, no Socket.io** (customer, admin, rider), plus FCM push | Kept |
| 10 | ~~Cloudinary~~ → **AWS S3** (+ CloudFront); files deleted from S3 when removed; voice notes deleted 7 days after delivery | Changed |
| 11 | Loose items = fixed variants, pooled gram stock **per warehouse** | Updated |
| 12 | ~~Fee mode flat/distance~~ → **zone rules engine** (amount tiers, always-free zones, surcharges) | Changed |
| 13 | Manual refunds with "Mark refund done" | Kept |
| 14 | WhatsApp number/Meta account ready; submit templates in Phase 1 | Kept |
| 15 | A zone has many warehouses; a warehouse has one zone; zones don't overlap | New |
| 16 | Customer sees the zone's combined catalog; same product in several warehouses of a zone must have the same price (`block` default / `warn`) | New |
| 17 | Orders may **split across warehouses**: customer sees separate orders; one bill and one delivery fee | New |
| 18 | Warehouse chosen per line by allocation (nearest in-stock, admin priority tie-break) | New |
| 19 | Rider belongs to one zone, many warehouses; batches may include pickups from several warehouses; admin chooses same/different rider for split orders | New |
| 20 | Riders cannot reject; assignment needs acknowledgement; no ack in 2 min → WhatsApp + admin alert | New |
| 21 | Cash settles per warehouse of the order; riders may switch warehouse mid-shift | New |
| 22 | Import copies product, variants, images, price, qty (all editable); single or bulk; no sync, no stock transfer | New |
| 23 | Pack time and rider-arrival time are two per-warehouse settings added to the ETA | New |
| 24 | If the delivery address changes zone: re-price cart, flag unavailable items, ask customer to confirm | New |
| 25 | Late hours/after-hours behaviour, fees, hours, zones are all admin settings | New |
| 26 | Offline delivery: client-side OTP check gates the UI; **server re-verifies on sync**; flagged for review | New |

## 15. Risks and open questions

**Risks**
- Razorpay webhooks lost/duplicated → idempotency + reconciliation.
- Android kills the background rider app → foreground service, battery-optimization onboarding, full-screen-intent permission check.
- Offline 4-digit OTP check can be brute-forced on a rooted device → server re-verification, attempt limits, GPS proximity, review of every offline delivery.
- Doorstep UPI cannot be verified offline → `upi_unverified` + nightly bank reconciliation; use a business VPA.
- Same product priced differently across warehouses of a zone → price rule (`block`/`warn`).
- Imported quantities duplicate "paper stock" → preview with explicit confirm; stock-take tool.
- Split orders are complex (two packings, partial cancel, fee allocation) → strict allocation rules in `02` §6.
- WhatsApp template approval delay and marketing-message opt-in rules.
- In-memory state breaks with multiple API instances → keep one instance.

**Open questions**
1. Hosting/budget and domain?
2. Real numbers: fee tiers, surcharge amounts, opening hours, pre-order windows, zone polygons, pack/rider-arrival minutes (all settings – placeholders used in docs).
3. GST: on delivery fees/surcharges; per-warehouse GSTIN and invoice numbering (CA).
4. Can a rider also be a customer on the same phone? (Currently one role per user – deferred.)
