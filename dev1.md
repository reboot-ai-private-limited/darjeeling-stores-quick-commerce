# Dev 1 — Commerce, platform and web

Planning baseline: 2026-11-05. Repository currently contains README plus 27 specification documents, with no application code or test commands. This is proposed work, not completed implementation. Companion: [dev2.md](dev2.md).

## Working agreement

Dev 1 owns commerce APIs, database foundations, shared contracts, infrastructure, storefront, and commerce/admin pages. Dev 2 owns delivery APIs, both mobile apps, and delivery/admin pages. Integrate one working feature at a time; do not finish the entire backend before connecting clients.

Use the documented monorepo: `apps/api`, `apps/web`, `apps/customer-app`, `apps/rider-app`, `packages/shared`. Keep Express/Mongoose/Zod, Next.js, Expo dev builds, Mongo jobs, HTTP polling, and one API instance. No Redis, sockets, microservices, payout engine, or stock-transfer system.

Dev 1 owns root configuration, lockfile, API bootstrap, shared auth/settings/jobs/media infrastructure, commerce collections and the web layout/navigation. Dev 2 owns delivery modules and their collections and web routes. Dev 2 registers routes and jobs through agreed interfaces; shared-file changes are coordinated before editing. Each developer writes tests for their own logic and reviews the other's changes. Feature contracts are agreed together; Dev 1 merges shared contract changes first.

## Shared sequence and integration gates

| Stage | Dev 1 | Dev 2 | Gate before advancing |
|---|---|---|---|
| 0 | Repo, API, auth, permissions, settings, jobs | Mobile shells, delivery contracts, device feasibility | Auth works in web and both apps; shared contracts agreed |
| 1 | Geography, media, catalog, stock, admin import | Customer browse/address UI; rider setup | Admin stock appears in the correct customer zone |
| 2 | Fees, allocation, quotes, COD placement, order transitions | Customer checkout and delivery services/UI | One COD order goes from checkout to delivery and cash deposit |
| 3 | Online payments, cancellation, refunds, packing | Dispatch batches, handover, cash reconciliation | Split orders and payment/cancellation races pass |
| 4 | Commerce Phase 2 and reporting | Offline delivery, tracking, customer cache | Weak-network and financial reconciliation scenarios pass |
| 5 | Deploy/restore, settings, operational readiness | Device acceptance and release builds | Joint pilot and release checklist complete |

These are dependency stages, not promised weeks. The overview's 1 + 4–5 + 3 week estimates are draft targets; re-estimate after Stage 0. Mobile and payment integration are significant work for two people.

## 0. Foundation and decisions

Read [overview](docs/00-overview.md), [data model](docs/01-data-model.md), F01–F03, F23–F25 first; use the README feature index for all remaining specifications.

- [ ] D1.0a — Together resolve the decision list below and freeze initial request/response examples, errors, IDs, state transitions and event payloads. Include quote, group/child, assignment, cash and sync contracts. **Done:** both developers can build against identical fixtures. **Dependency:** none.
- [ ] D1.0b — Scaffold workspaces, API health/config, Mongo connection/index setup, web shell, shared validation/types and seed data. Add CI checks and a staging deployment with one API instance. **Done:** documented setup starts API/web and a repeatable seed creates two warehouses in one zone plus another zone for isolation checks. **Dependency:** 0a.
- [ ] D1.0c — Implement F01/F02 auth, OTP expiry/attempt limits, refresh revocation, staff password/2FA, permission and warehouse-scope enforcement. Build web login and staff/roles screens. **Done:** customer, rider and staff access boundaries and revoked sessions are verified. **Dependency:** 0b; coordinate rider preregistration with Dev 2.
- [ ] D1.0d — Build F25 settings registry, scope resolution, history/audit and cache invalidation; F23 durable jobs/retries and channel adapter interfaces. **Done:** changing a scoped setting affects the next request; a restarted worker recovers jobs without duplicate business effects. **Dependency:** 0c.

Verification: create actual build/typecheck/lint/test commands when scaffolding and record them in README. Run focused auth, scope, settings and job-recovery checks plus a web/mobile login walkthrough with Dev 2.

## 1. Sellable catalog

- [ ] D1.1a — F03 geography APIs/admin: cities, localities, polygons, warehouses, non-overlap checks; F17 opening hours, cutoffs and pause behavior. **Done:** outside-zone, closed and paused requests are handled; active-order warehouses cannot be disabled. **Dependency:** Stage 0.
- [ ] D1.1b — F24 media upload/complete/read/remove, image processing, private access, deletion retries and retention jobs. **Done:** product images work through CloudFront, private media requires ownership/scope, all variants delete correctly. **Dependency:** jobs/auth. Deliver media contract to Dev 2 before address UI integration.
- [ ] D1.1c — F04 master catalog plus F05 offerings, pooled grams/per-variant units, price consistency, revisions and stock/price history. **Done:** concurrent deductions cannot oversell; stale admin edits fail; same-zone price conflicts follow the agreed policy. **Dependency:** 1a/1b.
- [ ] D1.1d — F06 tree, inline/bulk edits and import preview/commit. **Done:** skip/overwrite work, quantities require explicit confirmation, source stock stays unchanged and shared images remain valid. **Dependency:** 1c.
- [ ] D1.1e — F08 location/catalog/search/waitlist and F09 address APIs; web storefront browse/address flows. **Done:** zone catalog deduplicates offerings, closed stock is unavailable, own-address checks and zone changes work. **Dependency:** 1a–1c; hand APIs to Dev 2.

Verification: exercise admin create → import → customer browse in two zones, stock contention, pooled variants, denied location fallback and private media access.

## 2. First complete COD delivery

- [ ] D1.2a — F11 pricing/fee preview and F13 allocation reusable by quotes and placement; baseline F20 ETA using documented locality/warehouse fallbacks agreed with Dev 2. **Done:** integer-paise totals, tier edges, split shares and rounding are exact; no line splits across warehouses. **Dependency:** catalog/settings/hours.
- [ ] D1.2b — F10 server cart, zone-change confirmation, quote expiry/revalidation; F13 COD group/children, snapshots, idempotency and stock compensation. **Done:** retries return one group, failed allocations restore stock exactly once, changed quotes require confirmation. **Dependency:** 2a.
- [ ] D1.2c — F14 single transition service and packing/admin order screens, unavailable items, timeline, print slip/bill; storefront checkout/order history. **Done:** legal transitions only, fees never increase after placement, Dev 2 delivery calls use this service. **Dependency:** 2b; publish transition interface before Dev 2 delivery integration.
- [ ] D1.2d — F23 transactional events, FCM integration, OTP SMS fallback and notification log/retry UI. Submit WhatsApp templates with the account owner early, not at release. **Done:** delivery events trigger notifications once; failures are visible and retryable. **Dependency:** jobs and order events.

Joint gate: customer places COD → admin packs → Dev 2 dispatches → rider delivers with OTP → cash deposit balances. Repeat with a split group. Do not label isolated screens an MVP.

## 3. Payment and cancellation correctness

- [ ] D1.3a — F15 Razorpay order creation, provisional client verification, authoritative signed webhook, retries, expiry and reconciliation. **Done:** duplicate/out-of-order events, amount mismatch, restart and capture-vs-expiry races preserve one payment/stock outcome. **Dependency:** Stage 2.
- [ ] D1.3b — F16 cancellation, missing-item refunds and manual approve/reject/mark-done workflows; customer refund request/photo and web admin screens. **Done:** partial/full split cancellation follows charge rules, stock restoration is idempotent and refunds cannot exceed the refundable amount. **Dependency:** 3a and transition service.
- [ ] D1.3c — COD pay-online links and integration with Dev 2 cash/UPI reconciliation. **Done:** online payment clears amount due; offline double collection is retained as overpaid and routed to manual refund. **Dependency:** Dev 2 collection contracts and 3a/3b.

Verification: provider sandbox flows and integration tests for expiry, late payment, partial cancellation, duplicate refund actions and simultaneous collection/payment. Confirm invoice treatment before production receipts.

## 4. Phase 2 commerce and operations

- [ ] D1.4a — F12 coupons, atomic limits/redemptions, banners and admin editors. **Done:** concurrent last-use redemption respects limits; whole-group cancellation releases redemption as agreed. **Dependency:** stable pricing/payment/cancel flows.
- [ ] D1.4b — F17 preorder allocation, atomic slot capacity, cutoff and packing scheduler; F11 rain/night charges and preview. **Done:** midnight IST windows, paused slots, expiry and capacity contention pass; no new charges after placement. **Dependency:** Stage 3; Dev 2 slot UI.
- [ ] D1.4c — F07 zone-level availability subscriptions/demand list and F23 WhatsApp flows, preferences, templates and owner digest. **Done:** one-shot notifications use approved templates and respect preferences; failed sends retry. **Dependency:** stock events/jobs; coordinate all availability changes, including opening hours.
- [ ] D1.4d — F08/F21 resolved catalog delta API with tombstones/full-resync; integrate Dev 2 caches. **Done:** product edits, availability/price schedule changes and archives reach clients, not just stock edits. **Dependency:** catalog revisions and agreed invalidation design.
- [ ] D1.4e — F25 commerce dashboard/reports/CSV, customers, account anonymisation, audit/settings history and failed-media management. **Done:** scoped results, retained financial history and required media cleanup are verified. Dev 2 supplies delivery reports and reconciliation panels. **Dependency:** feature data available.

## 5. Release gate and unresolved specification decisions

Dev 1 leads deployment/configuration, backups and a restore drill, monitoring, job failure alerts and runbooks. Dev 2 leads device acceptance; both verify one full operating day, reconciliation and recovery in staging. Enter real polygons, fees, hours and business identifiers before pilot. Obtain owner/accountant input on tax/invoice rules and owner/legal input on privacy/retention; documentation placeholders are not approved business values.

Resolve these before their dependent implementation; record decisions in the owning specs:

| Issue found in docs | Decision needed / owner |
|---|---|
| F10/F13 reprice changed quotes; F25 says existing quotes retain locked settings | Dev 1 + Dev 2 agree quote validity and `QUOTE_CHANGED` behavior before Stage 2 |
| F03 stores hours/timers on warehouse; F25 also lists scoped settings | Dev 1 chooses one authoritative storage/resolution path before Stage 1 |
| Data model bans catalog hard deletes; F04/F24 allow never-ordered product deletion | Dev 1 reconciles deletion and shared-image references before media/catalog implementation |
| F05 allows price-conflict `warn`; F08 assumes one guaranteed price | Dev 1 defines deterministic pricing under warn mode, or leaves warn unavailable pending a decision |
| F09/F21 allow placement before uploads finish; F24 copies media at placement | Both define late-upload attachment/ownership and retry semantics before checkout |
| F12 redemption release wording is broader than F16 whole-group rule | Dev 1 reconciles partial cancellation before coupons |
| F18 return/handover paths extend F14 state diagram | Both define legal return transitions before delivery integration |
| Group OTP shared by children, but data model says clear after delivery | Both define clearing only after every child no longer needs it |
| Stock compensation and status/event writes span documents | Dev 1 specifies crash recovery and idempotent repair before orders; do not assume in-process rollback survives a crash |
| F20 sits in Phase 2 but quotes/allocation need ETA in Phase 1 | Both deliver baseline fallback ETA early, Routes/live map later |

Other owner inputs: hosting/domain/budget, provider access and template approval, packer login practice, rider/customer shared phone policy, cash deposit sign-off, business VPA, practical warehouse batching distance and retention periods. Preserve documented defaults while unresolved, but do not silently invent production values.

## Scope after pilot

Phase 3 remains backlog: abandoned-cart nudges, substitutions, ratings, bulk CSV catalog import, advanced analytics, expiry/batch tracking, barcode packing and automatic multi-stop route ordering. Ratings are inconsistently labelled Phase 2 in F13 and Phase 3 in the overview: confirm before scheduling. CSV report export is Phase 2; warehouse-to-warehouse import is Phase 1; neither is the deferred bulk catalog CSV import.

No implementation or runtime tests were performed for this plan. Existing schedules remain estimates until the two developers size these slices and validate provider/device constraints.
