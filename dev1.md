# Dev 1 — Identity, geography, orders and money (and the web app)

Status: Proposed, 2026-11-05. Shared rules, ports, events and gates: [team split and working agreement](docs/engineering/team-split.md). **Read that first.** Companion: [dev2.md](dev2.md). Detailed foundation steps B01–B22: [tasks/todo.md](tasks/todo.md).

Already in code: the API runtime foundation (validated config, safe errors, MongoDB connection and readiness, boundary checks), B02–B05. Everything below is planned.

## 1. Your job in one sentence

Own who can log in and what they may do, where we deliver, how a basket becomes a priced and paid order, and the web app. Provide Dev 2 the contracts it plugs into, and never depend on Dev 2's modules being finished.

## 2. What you own

**Features (12):** F01 authentication · F02 roles and permissions · F03 zones and warehouses · F10 cart and quote · F11 fees and surcharges · F12 coupons and banners · F13 order placement and split orders · F14 lifecycle and packing · F15 payments · F16 cancellations and refunds · F17 hours, pre-orders and ops mode · F25 admin, settings and reports. About 134 endpoints, listed in `docs/api/F??-*.md`.

| Area | You own |
|---|---|
| API modules | `health`, `identity`, `access`, `audit`, `settings`, `geography`, `pricing`, `coupons`, `cart`, `quotes`, `orders`, `payments`, `refunds`, `preorders` under `apps/api/src/modules/` |
| API plumbing | `server.ts`, `app.ts`, `container.ts`, `config/`, `shared/`, `platform/` (contract layer), `composition/dev1.ts` |
| Collections | `users`, `refresh_tokens`, `device_tokens`, `otps`, `roles`, `audit_log`, `settings`, `settings_history`, `sequences`, `cities`, `localities`, `zones`, `warehouses`, `delivery_rules`, `coupons`, `coupon_redemptions`, `banners`, `carts`, `quotes`, `order_groups`, `orders`, `order_events`, `payments`, `refunds` |
| Web | `apps/web` shell, shared UI, storefront (Phase 2) and the core admin pages: login, staff and roles, zones and warehouses, delivery rules, coupons and banners, orders and packing, payments and refunds, settings, dashboard, reports, customers, audit |
| Packages | `packages/shared/src/{core,dev1}`, `packages/config` |
| Repo | Root config, lockfile, CI, Docker Compose, `tasks/`, engineering docs |

## 3. What you must not touch

Dev 2's modules (`catalog`, `offerings`, `availability`, `discovery`, `addresses`, `media`, `notifications`, `jobs`, `riders`, `dispatch`, `delivery`, `cash`, `tracking`, `offline-sync`), `composition/dev2.ts`, `apps/customer-app`, `apps/rider-app`, `packages/mobile-kit`, Dev 2's admin page folders and `dev2.nav.ts`, `packages/shared/src/dev2`. Use their `.public.ts` or a port instead. If a port is wrong, open a contract PR.

## 4. What you give Dev 2 (and when)

| You provide | Port or contract | Needed by Dev 2 for | Ready |
|---|---|---|---|
| Seams: ports, events, fakes, composition files, shared folders | `platform/`, S0 | Everything in `apps/api` | **First, about 1 day** |
| Fake actor and permission check | `auth` | All their admin and rider routes | S0 (fake), D1-2 (real) |
| Rider user pre-registration, deactivation, session revoke | `identity` | Riders (D2-7) | S0 (fake), D1-1/D1-2 (real) |
| Zone and warehouse reads, open or paused now | `geography` | Catalog, discovery, delivery | S0 (fake), D1-5 (real) |
| Settings and audit | `settings`, `audit` | All modules | S0 (fake), D1-1/D1-3 (real) |
| Order read, the one state machine, collection record, delivery OTP check | `orders` | Delivery, cash, tracking | S0 (fake), D1-8 (real) |
| Automatic refund creation | `refunds` | Cash reconciliation, failed delivery | S0 (fake), D1-9 (real) |
| Baseline ETA | `eta` | Quotes now, tracking later | D1-7 |
| Report and dashboard registry | `reports` | Delivery reports | S0 (fake), D1-11 (real) |
| Login, `/me`, app-config, zones, quotes, orders, payments, refunds endpoints | `docs/api` + fixtures | Both mobile apps | Fixtures in each task; real endpoints at G1, G3, G4 |
| Domain events | `platform/events.ts` | Notifications, tracking, delivery | S0 (types), each task (publishing) |

## 5. What you use from Dev 2 (and your stand-in until it lands)

| You consume | Port | Until real, use |
|---|---|---|
| Atomic stock reserve, release, restore | `stock` | In-memory stock fake |
| Zone prices and availability for cart lines | `catalog` | Small fixed catalog fake |
| A customer's address with its zone | `addresses` | In-memory addresses |
| File copy to orders, signed URLs, deletion scheduling | `media` | Fake URLs |
| Durable jobs (payment expiry, reconciliation) | `jobs` | In-memory timer queue |
| OTP sending (WhatsApp, SMS fallback) | `otp-transport` | Capture the code in tests |

Switching to the real module is one line in `composition/dev1.ts`, followed by your integration test.

## 6. Work packages, in order

Every package can start now. "Stand-in" is what you use for anything Dev 2 owns. "Includes web" means the admin pages for that module are part of the package.

| ID | Work | Features | Stand-in | Done when |
|---|---|---|---|---|
| **S0** | **Seam PR** (see [team split §8](docs/engineering/team-split.md)) | — | — | Both devs build with fakes; boundary and duplicate-route checks pass; Dev 2 has approved |
| D1-1 | Audit writer, user and role data, permission registry and seed, **operator-run owner bootstrap** with password hashing (B06–B08) | F01, F02 | none | No built-in credentials; reseeding keeps admin-edited roles; secrets never reach audit payloads |
| D1-2 | Staff login with lockout and expiring 2FA, JWT access plus rotating refresh with replay handling, permission middleware, warehouse scope, staff and role admin (B09–B12). Includes web: login, staff, roles | F01, F02 | none | Same permission, other warehouse is denied; revoked or deactivated users cannot continue; owner login works end to end |
| D1-3 | Settings registry with warehouse, zone and global resolution, history, cache refresh, public app-config (B13–B14). Includes web: settings, history | F25, F01 | none | A scoped change affects the next request; the public config never exposes secrets |
| D1-4 | Customer and rider OTP login, atomic OTP use, throttling, profile, phone change, device tokens, deletion request (B15–B17) | F01 | `otp-transport` capture | Rider and customer flows are distinct; expiry is checked in the query; unknown or blocked numbers reveal nothing |
| D1-5 | Cities, localities, zones (overlap check, boundary rules), warehouses, location resolve, hours and pause fields (B18–B20). Includes web: zones map and warehouse pages | F03, F17 | none | Inside, outside, boundary and overlapping polygons behave as specified; `geography` port is real. **G1 reached with Dev 2's apps** |
| D1-6 | Fee tiers, always-free zones, small and handling fees, pricing engine as pure functions, coupons with atomic limits. Includes web: fee rules with preview, coupons, banners | F11, F12 | none | Bills are exact in paise; tier edges and split shares have tests; a last-use coupon cannot be redeemed twice |
| D1-7 | Server cart, zone-change handling, allocation (nearest in-stock, split rules), quote lock and expiry, baseline ETA | F10, F13 (allocation), F20 (baseline) | `stock`, `catalog`, `addresses` fakes | A split cart returns one bill and two deliveries; a stale quote returns `QUOTE_CHANGED` |
| D1-8 | COD placement with idempotency, order groups and children, the **single state machine**, order events, packing, unavailable items, print. Publishes events. Includes web: orders, packing | F13, F14 | `stock`, `media` fakes | Retries return one group; only legal transitions pass; fees never rise after placement; `orders` port is real |
| D1-9 | Razorpay order, verify, signed webhook, expiry job, reconciliation; cancellation and manual refunds; COD pay-link. Includes web: payments, refunds | F15, F16 | `jobs` fake | Duplicate or late webhooks and capture-vs-expiry races leave one outcome; partial cancel follows the charge rules |
| D1-10 | Pre-orders with slot capacity and cutoff, rain and late-night surcharges, pause and resume | F17, F11 | `jobs` fake | Midnight IST windows and slot contention pass; no new charge after placement |
| D1-11 | Dashboard, reports, customers (block, COD flag, deletion finalisation), audit and settings screens, report and widget registry | F25 | Dev 2 registers its reports later | Scoped totals match the underlying orders and ledgers |
| D1-12 | Storefront web (Phase 2), staging deployment, backups and restore drill, monitoring, runbooks | — | — | A restore is rehearsed; deploy and rollback steps work from the runbooks |

Order: S0 first, then D1-1 to D1-5 (foundation, matches `tasks/todo.md`), then D1-6 to D1-10 (money), then D1-11 and D1-12. D1-6 can run in parallel with D1-4 and D1-5 if you want to overlap, because they share no collection.

## 7. Spec conflicts you decide

From the [conflict table](docs/engineering/team-split.md#12-spec-conflicts-to-settle-each-has-one-owner): quote re-price and locked settings (before D1-7), hours on warehouse versus scoped settings (before D1-5), coupon release versus whole-group cancel (before D1-6), legal return and handover transitions (before Dev 2's D2-8), group OTP clearing (before D1-8), ETA baseline (D1-7). Record each answer in the owning spec.

## 8. Rhythm with Dev 2

- **Handoff:** after each package, post the endpoints you finished, the fixtures path and any new event. Dev 2 switches the matching fake to real.
- **Your reviews:** only contract PRs, money, permissions and scope changes from Dev 2. Everything else merges on green checks.
- **Gates you lead:** G1 (login and zones), G3 (first COD order), G4 (payments and refunds).
- **If Dev 2 is late:** keep going on the fake. If Dev 2's stock or catalog is the blocker for a quote test, the in-memory fake already enforces the same reserve and release rules.

Not planned here: Phase 3 items (abandoned-cart nudges, substitutions, ratings, bulk CSV import, advanced analytics, expiry tracking, barcode packing, automatic route ordering).
