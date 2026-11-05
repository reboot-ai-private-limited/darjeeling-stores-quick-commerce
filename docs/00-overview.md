# 00 – Overview: Darjeeling Stores Quick Commerce

Status: draft v3 · Updated 2026-11-05 · This is the index. Each feature has its own doc (F01–F25). Shared data model: `01-data-model.md`.

## 1. Goals and scale

- **Launch:** ~50 orders/day, 6 in-house salaried riders, 1 zone, 1–2 warehouses.
- **Model scale:** many cities → zones → warehouses from day one (cheap now, painful to retrofit).
- **Architecture:** modular monolith, one Express API instance, one MongoDB. No microservices, no Redis, no sockets.
- **Sells:** groceries, vegetables, fruits, dairy, staples, household. Single vendor (the owner); `vendorId` defaults to the owner for a later marketplace.
- **Hill-region constraints:** weak 2G/3G, dead spots, steep winding roads, rain and landslides, inaccurate GPS pins.

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
| Backend | Node.js + Express (TypeScript) + Mongoose + Zod | Modular monolith, single instance |
| DB | MongoDB (Atlas, replica set) | `2dsphere`; atomic `updateOne` with `$gte` for stock; money in integer paise |
| Live updates | HTTP polling + FCM push (no Socket.io) | Customer ~10 s, admin ~5 s, rider ~15 s |
| Web | Next.js (App Router): storefront at `/`, admin at `/admin` | One app, no separate React app |
| Mobile | React Native (Expo dev build): Customer (Android+iOS), Rider (Android only) | FlashList, MMKV, expo-image, expo-haptics, Notifee |
| Maps | Google Maps Platform | Cache ETA calls per (address, warehouse) |
| Files | AWS S3 (+ CloudFront for public images) | See F24 |
| Infra | Docker, 1 VPS (or Render/Railway) + Atlas, Sentry | |

Monorepo: `apps/api  apps/web  apps/customer-app  apps/rider-app  packages/shared  docs/`

### Without Redis

| Need | Replacement |
|---|---|
| OTP storage | `otps` collection, TTL index |
| Rate limiting | `express-rate-limit` (in-memory) |
| Settings cache | In-memory, refreshed on admin save |
| Job queue | `jobs` collection + worker polling every few seconds |
| Timeouts (ack, expiry) | Persisted deadline fields plus a sweeper job |

**Rule:** one API instance. If we ever scale out, add Redis then.

## 3. Geography in one picture

```
City (label, locality dropdown)
 └─ Zone (polygon, delivery rules, riders belong to one zone)
     └─ Warehouse 1..N (belongs to exactly ONE zone; own stock, prices, hours, pack time)
```
A customer's location decides the zone, and the zone decides the catalog, prices, fees and ETA. Details: F03.

## 4. Feature index

| Folder | ID | Feature | Phase |
|---|---|---|---|
| **foundation** | [F01](foundation/01-authentication.md) | Authentication | 0–1 |
| | [F02](foundation/02-roles-and-permissions.md) | Roles & permissions | 1 |
| | [F03](foundation/03-zones-and-warehouses.md) | Cities, zones & warehouses | 1 |
| **catalog** | [F04](catalog/04-master-catalog.md) | Master catalog | 1 |
| | [F05](catalog/05-warehouse-stock-and-pricing.md) | Warehouse stock & pricing | 1 |
| | [F06](catalog/06-product-import-and-admin-tree.md) | Product import & admin tree | 1 |
| | [F07](catalog/07-notify-me.md) | Notify Me | 2 |
| **customer** | [F08](customer/08-discovery-and-location.md) | Discovery & location | 1 |
| | [F09](customer/09-addresses.md) | Addresses | 1 |
| | [F10](customer/10-cart-and-quote.md) | Cart & quote | 1 |
| | [F11](customer/11-delivery-fees-and-surcharges.md) | Delivery fees & surcharges | 1–2 |
| | [F12](customer/12-coupons-and-offers.md) | Coupons & offers | 2 |
| **orders** | [F13](orders/13-order-placement-and-split-orders.md) | Order placement & split orders | 1 |
| | [F14](orders/14-order-lifecycle-and-packing.md) | Order lifecycle & packing | 1 |
| | [F15](orders/15-payments.md) | Payments | 1–2 |
| | [F16](orders/16-cancellations-and-refunds.md) | Cancellations & refunds | 1 |
| | [F17](orders/17-hours-preorders-and-ops-mode.md) | Hours, pre-orders & ops mode | 1–2 |
| **delivery** | [F18](delivery/18-dispatch-and-assignment.md) | Dispatch, assignment & handover | 1 |
| | [F19](delivery/19-rider-app.md) | Rider app | 1 |
| | [F20](delivery/20-eta-and-live-tracking.md) | ETA & live tracking | 2 |
| | [F21](delivery/21-offline-and-low-network.md) | Offline & low network | 2 |
| | [F22](delivery/22-rider-cash-and-settlement.md) | Rider cash & settlement | 1–2 |
| **platform** | [F23](platform/23-notifications.md) | Notifications | 1–2 |
| | [F24](platform/24-media-storage.md) | Media storage (S3) | 1 |
| | [F25](platform/25-admin-panel-settings-and-reports.md) | Admin panel, settings & reports | 1–2 |

## 5. Roadmap

1. **Phase 0 – Foundations (1 wk):** monorepo, Express skeleton, Mongo, OTP auth, settings with scope resolution, CI, deploy.
2. **Phase 1 – Core MVP (4–5 wks):** geography, catalog + warehouse stock + admin tree + import, zone browse, cart + quote + fee rules, COD + Razorpay, split-order allocation, admin orders + manual dispatch + batches, rider app (shift, ack alarm, pickup, ride, OTP, cash), push, WhatsApp templates submitted.
3. **Phase 2 – Quick-commerce features (3 wks):** ETA (Routes), rain mode + night fee, tracking map + public link, offline rider bundle and sync, local UPI QR, Notify Me, pre-orders, delta sync, WhatsApp flows, coupons, owner digest, reports.
4. **Phase 3 – Polish:** abandoned-cart nudge, substitutions, ratings, bulk CSV, analytics, expiry/batch tracking, route ordering for multi-stop batches.

## 6. Decisions log

| # | Decision | Doc |
|---|---|---|
| 1 | Multi-warehouse model: City → Zone → Warehouse | F03 |
| 2 | Riders salaried, no payout engine | F19 |
| 3 | Quick delivery plus optional next-morning pre-order windows | F17 |
| 4 | All settings editable in the admin panel, scope warehouse → zone → global | F25 |
| 5 | Google Maps | F20 |
| 6 | React Native (Expo) for both apps | 00 |
| 7 | Express + MongoDB backend; all web in Next.js | 00 |
| 8 | No Redis (single instance) | 00 |
| 9 | Polling only, no Socket.io, plus FCM push | 00, F20 |
| 10 | AWS S3 + CloudFront, delete on remove, voice notes deleted 7 days after delivery | F24 |
| 11 | Loose items sold as fixed variants, pooled gram stock per warehouse | F05 |
| 12 | Zone rules engine for fees, no flat/distance mode | F11 |
| 13 | Refunds are manual with a "Mark refund done" action | F16 |
| 14 | WhatsApp number and Meta account ready, submit templates in Phase 1 | F23 |
| 15 | A zone has many warehouses, a warehouse has one zone, zones do not overlap | F03 |
| 16 | Zone catalog is combined, same product in a zone must have the same price (`block` default) | F05 |
| 17 | Orders split across warehouses: separate orders for the customer, one bill and one delivery fee | F13 |
| 18 | Warehouse chosen per order: nearest with everything in stock, admin priority tie-break | F13 |
| 19 | Rider belongs to one zone, many warehouses, batches may span warehouses | F18 |
| 20 | Riders cannot reject, they acknowledge, no ack in 2 min means WhatsApp plus admin alert | F18 |
| 21 | Cash settles per warehouse of the order, riders may switch warehouse mid-shift | F22 |
| 22 | Import copies product, variants, images, price, qty (editable), single or bulk, no sync, no stock transfer | F06 |
| 23 | Pack time and rider-arrival time are two per-warehouse settings added to ETA | F20 |
| 24 | Address in another zone: re-price cart, flag unavailable items, customer confirms | F10 |
| 25 | After-hours, fees, hours and zones are admin settings | F11, F17 |
| 26 | Offline delivery: client OTP check gates the UI, server re-verifies on sync, flagged for review | F21 |

## 7. Risks

- Razorpay webhooks lost or duplicated → idempotency and reconciliation (F15).
- Android kills the background rider app → foreground service, battery prompts (F19). The full-screen alarm permission may be restricted on Google Play, so plan direct APK distribution for the 6 riders.
- Offline 4-digit OTP can be brute-forced on a rooted device → server re-verification, attempt limits, GPS check, review list (F21).
- Doorstep UPI cannot be verified offline → `upi_unverified` and nightly bank reconciliation (F15).
- Same product priced differently across warehouses of one zone → price rule (F05).
- Imported quantities duplicate paper stock → preview with explicit confirm (F06).
- Split orders are complex (two packings, partial cancel, fee allocation) → strict rules (F13).
- WhatsApp template approval delay and marketing opt-in rules (F23).
- S3 versioning is off so deletes are final, and there is no on-the-fly image resizing (F24).
- Voice notes and location are personal data → privacy policy, consent, retention (F24). Check India's data protection law with a lawyer.
- In-memory state breaks with multiple API instances → keep one instance.

## 8. Open questions

1. Hosting, budget and domain.
2. Real numbers: fee tiers, surcharge amounts, hours, pre-order windows, zone polygons, pack and rider-arrival minutes (all settings, placeholders in docs).
3. GST on delivery fees and surcharges, per-warehouse GSTIN and invoice numbering (CA).
4. Can a rider also be a customer on the same phone? Currently no.
5. Packers: separate logins per warehouse or one shared admin device?
6. Address-level voice note and house photo: keep per address, or only per order? House photo retention? Evidence photo retention (placeholder 90 days)?

## 9. Glossary

| Term | Meaning |
|---|---|
| Zone | Polygon where we deliver; has delivery rules; riders belong to one zone |
| Warehouse | Physical stock and packing point; belongs to exactly one zone |
| Order group | One checkout: one customer, address, payment, bill, delivery fee and delivery OTP |
| Child order | The part of a group fulfilled by one warehouse; shown to the customer as an order |
| Batch | A rider's ordered list of stops (pickups and drops) |
| Quote | A server-computed bill and ETA, valid about 5 minutes |
| Offering | A warehouse's price and stock for a product (`warehouse_products`) |
| Ack | A rider's acknowledgement of an assignment |
| Grace time | Pack time plus rider-arrival time added to the ETA |
