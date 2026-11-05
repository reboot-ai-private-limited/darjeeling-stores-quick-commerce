# Dev 2 — Catalog, delivery, engagement and both mobile apps

Status: Proposed, 2026-11-05. Shared rules, ports, events and gates: [team split and working agreement](docs/engineering/team-split.md). **Read that first.** Companion: [dev1.md](dev1.md). Mobile device-verification rules: [docs/engineering/mobile.md](docs/engineering/mobile.md).

Already in code: only the API runtime foundation (validated config, safe errors, MongoDB connection and readiness, boundary checks). The mobile directories contain notes only. Everything below is planned.

## 1. Your job in one sentence

Own what is for sale and where its stock is, how an order reaches the door and cash comes back, the messages and files around it, and both mobile apps. Build every package against the contracts and fakes, so you never wait for Dev 1's modules.

## 2. What you own

**Features (13):** F04 master catalog · F05 offerings and stock · F06 import and product tree · F07 Notify Me · F08 discovery · F09 addresses · F18 dispatch · F19 rider app · F20 ETA and tracking · F21 offline · F22 rider cash · F23 notifications · F24 media. About 126 endpoints, listed in `docs/api/F??-*.md`.

| Area | You own |
|---|---|
| API modules | `catalog`, `offerings`, `availability`, `discovery`, `addresses`, `media`, `notifications`, `jobs`, `riders`, `dispatch`, `delivery`, `cash`, `tracking`, `offline-sync` under `apps/api/src/modules/`, plus `composition/dev2.ts` |
| Collections | `categories`, `products`, `warehouse_products`, `stock_movements`, `price_history`, `catalog_revisions`, `stock_subscriptions`, `waitlist`, `addresses`, `media_files`, `notification_templates`, `notifications`, `jobs`, `riders`, `rider_shifts`, `assignments`, `delivery_batches`, `offline_events`, `cash_ledger`, `rider_location_trail` |
| Mobile | `apps/customer-app` (Android and iOS), `apps/rider-app` (Android only), `packages/mobile-kit` (API client, secure session, offline outbox, UI kit) |
| Web pages | Under `apps/web/src/app/(admin)/admin/`: `catalog`, `inventory`, `media`, `notifications`, `riders`, `dispatch`, `cash`, `reconciliation`, `offline-reviews`; and the public `apps/web/src/app/track/` page; menu in `dev2.nav.ts` |
| Contracts | `packages/contracts/mock-api`; fixtures for your features; `packages/shared/src/dev2` |

Besides the features you own, **you build the mobile screens for every customer and rider feature, including Dev 1's** (login, cart, quote, orders, payments, refunds, coupons, pre-orders). Dev 1 owns those features' backend and fixtures; you consume them through the mock until they are real.

## 3. What you must not touch

Dev 1's modules (`health`, `identity`, `access`, `audit`, `settings`, `geography`, `pricing`, `coupons`, `cart`, `quotes`, `orders`, `payments`, `refunds`, `preorders`), `server.ts`, `app.ts`, `container.ts`, `platform/` (without a contract PR), `composition/dev1.ts`, the root config and lockfile, the rest of `apps/web`, `packages/shared/src/{core,dev1}`. Call their `.public.ts` or a port. **Never write a second order state machine, pricing engine or auth service.** (You do own the job queue itself, as the `jobs` module.)

## 4. What you give Dev 1 (and when)

| You provide | Port | Needed by Dev 1 for | Ready |
|---|---|---|---|
| Durable jobs: enqueue, handler, cancel | `jobs` | Payment expiry, reconciliation, pre-order release | D2-2 (real); fake until then |
| OTP sending with WhatsApp then SMS fallback | `otp-transport` | Customer and rider login | D2-2 |
| File copy onto orders, signed read URL, deletion scheduling | `media` | Order placement, refunds | D2-3 |
| Atomic stock reserve, release, restore, availability | `stock` | Orders and cart | D2-4 |
| Zone prices and availability for cart lines | `catalog` | Cart and quote | D2-4 |
| A customer's address with its zone | `addresses` | Quote and orders | D2-6 |
| Routes-based ETA (same interface as the baseline) | `eta` | Quotes, tracking | D2-10 |
| Fixtures and real endpoints for your features | `docs/api` + `packages/contracts` | Web admin pages | Per package |
| Domain events (stock, assignment, delivery, collection) | `platform/events.ts` | Notifications, reports | Per package |

## 5. What you use from Dev 1 (and your stand-in until it lands)

| You consume | Port | Until real, use |
|---|---|---|
| Actor, permissions, warehouse scope | `auth` | Fake actor from a test header (dev and test only, never production) |
| Pre-register or deactivate a rider's user | `identity` | In-memory users |
| Zone, warehouse, open or paused now | `geography` | Two warehouses in one zone, one in another |
| Settings and audit | `settings`, `audit` | Defaults and an in-memory log |
| Order read, status change, collection record, delivery OTP | `orders` | In-memory state machine with the legal transitions |
| Automatic refund creation | `refunds` | Records the call |
| Register reports and dashboard widgets | `reports` | Local registry |
| Login, quotes, orders, payments, refunds endpoints for the apps | `docs/api` fixtures | `packages/contracts/mock-api` |

Switching to the real module is one line in `composition/dev2.ts`; for the apps it is changing the API base URL from the mock to the real server.

## 6. Work packages, in order

Every package can start now. "Stand-in" is what you use for anything Dev 1 owns. "App" means the mobile screens in the same package. "Web" means the admin pages for the module.

| ID | Work | Features | Stand-in | Done when |
|---|---|---|---|---|
| **D2-0** | **Mobile foundation.** Expo dev-build shells for both apps, navigation, config, secure session storage, force-update and maintenance screens, permission screens. `packages/mobile-kit` (API client with the error envelope, polling helpers). `packages/contracts/mock-api` serving the fixtures | F01 (client) | `mock-api` | Both apps run in dev builds against the mock; login, refresh and logout screens work with fixtures; a blocked user cannot continue |
| **D2-1** | **Android feasibility spike** on the real rider phones: assignment push, Notifee full-screen alarm, background location, battery and permission behavior, APK install. Follow [mobile.md](docs/engineering/mobile.md) | F19 | none | Observed results recorded for screen locked, app backgrounded, permissions denied and battery limits, with a fallback plan |
| D2-2 | **Jobs and notifications.** Mongo-backed `jobs` with retries and sweepers; FCM, WhatsApp, SMS adapters; templates, delivery log, retry, broadcast, WhatsApp webhooks; `otp-transport`. Web: templates and log | F23 | `auth`, `audit` fakes | A restarted worker recovers jobs without duplicate effects; failures are visible and retryable. Submit WhatsApp templates early |
| D2-3 | **Media.** Presigned upload, image sizes, private signed reads, deletion jobs and sweepers, 7-day order-media expiry. Web: failed-deletion list | F24 | `auth` fake, `jobs` real | Removing an image deletes every size; private files need ownership or scope; expiry deletes on schedule |
| D2-4 | **Catalog and stock.** Master catalog, offerings (pooled grams and per-variant units), price rule, revisions, movements, atomic `StockService`, `CatalogReader`. Web: catalog, inventory, product tree | F04, F05 | `geography`, `auth` fakes | Concurrent orders cannot oversell the last unit; stale edits fail with `VERSION_CONFLICT`; same-zone price conflicts follow the agreed policy |
| D2-5 | **Import and Notify Me.** Preview and commit import between warehouses (skip or overwrite, quantity confirm); back-in-stock subscriptions and demand list. Web: import wizard | F06, F07 | `geography` fake | Source stock is unchanged; subscribers are notified once when zone availability goes from none to some |
| D2-6 | **Discovery and addresses.** Zone catalog read, search, delta sync with tombstones and full resync, store status, waitlist; address CRUD with landmark, voice note and photo. **App:** login, location, home, category, search, product, address | F08, F09 | `geography`, `auth` fakes; `mock-api` for login | Catalog deduplicates warehouses; no price appears before a zone is known; a changed price arrives through delta sync. **G2 reached with Dev 1** |
| D2-7 | **Riders, shifts and dispatch.** Rider admin, shifts and punch-in, assignment with acknowledgement and sweeper, batches, dispatch board, live map. **App (rider):** login, shift, alarm, order list. Web: riders, dispatch board | F19, F18 | `identity`, `orders`, `geography` fakes | Only eligible riders can be assigned; no reject action; a stale acknowledgement timer is cancelled after reassignment |
| D2-8 | **Delivery execution and cash.** Pickup, ride, arrived, deliver through `OrderTransitions`; failed delivery, handover, same or different rider for split orders; cash collection and ledger, deposits, reconciliation. **App (rider):** pickup checklist, navigation, doorstep, cash. Web: cash, reconciliation | F19, F18, F22 | `orders`, `refunds` fakes | Repeat collection cannot duplicate cash; the ledger is append-only and per warehouse; one group OTP completes same-rider children. **G3 with Dev 1** |
| D2-9 | **Customer app: shopping and orders.** Cart with optimistic steppers, quote and change confirmation, checkout with the idempotency key, order history and detail, payments, cancel and refund screens | F10, F13, F15, F16 (client) | `mock-api` for Dev 1's endpoints | A lost response and retry gives one order; offline placement is blocked; client payment success is never treated as final. **G4 with Dev 1** |
| D2-10 | **Offline and tracking.** Pickup bundle, SQLite outbox, sequence-ordered sync with applied, duplicate and conflict results, offline OTP gate, local UPI QR; Routes ETA, location pings, tracking APIs, public tracking page; customer MMKV cache and delta sync | F21, F20 | `orders`, `eta` fakes | Restart keeps pending events; replay applies each effect once; rider location shows only after pickup. **G5** |
| D2-11 | **Engagement, reports, devices, release.** Coupons, banners, pre-order and Notify Me screens; delivery reports registered with `reports`; device acceptance; signed rider APK and customer builds; rehearsal. Web: delivery dashboards | F12, F17, F07 (client), F25 (delivery reports) | `reports` fake | Results recorded for low-end Android, weak network and locked screen; a clean install and an upgrade both work. **G6** |

Order: D2-0 and D2-1 first (no shared files), then D2-2 to D2-5 (backend modules Dev 1 will plug in), then D2-6 to D2-8, D2-9 as Dev 1's endpoints land, then D2-10 and D2-11. D2-0 to D2-2 can all run at once.

## 7. Spec conflicts you decide

From the [conflict table](docs/engineering/team-split.md#12-spec-conflicts-to-settle-each-has-one-owner): catalog deletion versus the data-model ban (before D2-3 and D2-4), price `warn` versus one guaranteed price (before D2-4), late media upload versus copy at placement (jointly with Dev 1, before D2-3), stock crash recovery (jointly, before D2-4). Record each answer in the owning spec.

## 8. Device and mobile rules

Before writing any mobile UI test, follow [mobile.md](docs/engineering/mobile.md): `adb devices -l`, explore real screens, then author tests with deterministic waits. Do not claim device verification without device access. iOS acceptance for the customer app needs separate iOS tooling; Android results do not cover it.

## 9. Rhythm with Dev 1

- **Handoff:** after each package, post the endpoints you finished, the fixtures path and any new event or port change. Dev 1 switches the matching fake to real.
- **Your reviews:** only Dev 1's contract PRs, and anything touching money, permissions or scope. Everything else merges on green checks.
- **Gates you lead:** G2 (stock shows in the customer app) and G5 (offline and tracking).
- **If Dev 1 is late:** keep going on the fake and the mock. A fake that enforces the same rules as the real module is a contract, not a shortcut. Replace it at the gate.

Not planned here: Phase 3 items (abandoned-cart nudges, substitutions, ratings, bulk CSV import, advanced analytics, expiry tracking, barcode packing, automatic route ordering).
