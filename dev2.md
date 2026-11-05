# Dev 2 — Mobile apps and delivery operations

Planning baseline: 2026-11-05. The repository now includes an API foundation and a placeholder web application; business features and mobile applications remain planned. See [current documentation](docs/README.md) for implemented behavior. Companion and shared decision register: [dev1.md](dev1.md). Read its shared sequence and working agreement before starting.

## Ownership and reading order

Own `apps/customer-app`, `apps/rider-app`, delivery API modules for F18–F22, delivery collections (`riders`, `rider_shifts`, `assignments`, `delivery_batches`, `offline_events`, `cash_ledger`, optional location trail), and delivery routes/screens under the existing Next.js `/admin` app. Own mobile tests and delivery-service tests. Dev 1 owns commerce/platform services and storefront; both agree contracts before parallel work.

Read [overview](docs/00-overview.md) and [data model](docs/01-data-model.md), then F01/F02, F18–F22, F08–F17 and F23–F25. The [README](README.md) links every feature. All 25 features are covered across these two plans; frontend and backend tasks refer to the same specifications rather than separate behavior.

Do not write a second order state machine, pricing engine, auth service or job queue. Use Dev 1's shared services. Coordinate edits to `packages/shared`, API bootstrap, root config/lockfile and web navigation with Dev 1. Each checkbox below is a work package: split it into small PRs where needed, and merge API contract → service → client integration in that order.

## 0. Start in parallel with Dev 1

- [ ] D2.0a — Agree DTOs/error examples for login, zone catalog, address, quote, group/child, assignment, pickup bundle, collection and sync; review Dev 1's specification conflicts. **Done:** shared fixtures describe success, permission denial, retry and conflict cases. **Dependency:** none; joint D1.0a.
- [ ] D2.0b — After root scaffold lands, create Expo dev-build shells for customer Android/iOS and rider Android, navigation, configuration, secure session storage, login/update/maintenance and permission screens. **Done:** real API login, refresh and logout work when D1.0c lands; blocked/deactivated users cannot continue. **Dependency:** D1.0b/contracts; fixtures may unblock layout only.
- [ ] D2.0c — Early Android feasibility spike: assignment push, Notifee alarm, background location, battery/permission behavior and APK distribution on intended rider hardware. **Done:** record observed behavior with screen locked, app backgrounded, permissions denied and battery restrictions; document fallback handling. **Dependency:** rider dev build and FCM setup. Do not wait until release to discover hardware restrictions.

Verification for mobile work: before authoring executable mobile UI tests, inspect connected devices with `adb devices -l`, confirm preferred serial if multiple, and explore actual screens/interactions with ARTEMIS. Use Flash for simple deterministic paths, Pro for diagnostics/checkpoints. On errors call `mobile_diagnose` first, including self-heal before manual ADB intervention; if unavailable, follow the supplied MCP/doctor diagnostic instructions. Write framework-native dynamic locators with verified coordinate fallback only where supported, and explicit deterministic waits. Do not claim device verification if ARTEMIS/device access is missing. iOS acceptance needs separate iOS-capable tooling/device coverage; Android results do not verify iOS.

## 1. Customer discovery and rider setup

- [ ] D2.1a — F08 customer GPS/locality selection, outside-zone waitlist, home/category/search/product screens, variant steppers and closed/paused states. **Done:** correct zone catalog, no prices before zone selection, usable denied-location flow. **Dependency:** D1.1a/1c/1e; implement fixtures while APIs are being built, then replace them before gate.
- [ ] D2.1b — F09 address picker/form with required locality/landmark, receiver details, pin and accuracy warning, optional voice/photo upload/retry and delete. **Done:** cross-zone selection requests cart confirmation; private media uses Dev 1's authorized upload/read APIs. **Dependency:** D1.1b/1e and late-upload decision.
- [ ] D2.1c — F19 rider onboarding/profile, zone/allowed warehouses, shifts, breaks, warehouse switching and admin rider management. Build APIs plus delivery admin pages. **Done:** cross-zone warehouse grants are rejected, deactivated riders cannot start, outside-radius punch-in is flagged and active-order shift-end rules are enforced. **Dependency:** D1 auth/scope/geography/settings.

Gate with Dev 1: an admin creates stock that appears in customer browse; a preregistered rider logs in and starts a shift at an allowed warehouse. Verify own-data and scoped-staff boundaries server-side.

## 2. COD checkout through delivery

- [ ] D2.2a — F10 customer cart/checkout: optimistic steppers, server corrections, itemised bill, quote expiry/change confirmation, zone repricing, split notice and persistent checkout idempotency key. **Done:** lost response/retry produces one group, offline placement is blocked, changed totals need acceptance. **Dependency:** D1.2a/2b.
- [ ] D2.2b — F13/F14 customer order success/history/detail, child timelines and delivery OTP. **Done:** each child updates independently and group status matches server roll-up. **Dependency:** D1 placement/transition contracts.
- [ ] D2.2c — F18 manual assignment and suggested-rider ranking, ack deadline, unassign/reassign, assignment polling and admin dispatch board. Use Dev 1 jobs/events and transition service. **Done:** only eligible riders are assigned; no reject action; stale ack escalation is cancelled after reassignment; counts stay correct under retries. **Dependency:** D2.1c, D1.2c/2d.
- [ ] D2.2d — F19 rider alarm/ack, pickup checklist, start ride, navigation/call/voice, arrival, online OTP and delivery. **Done:** customer receives updates; rider cannot read another rider's order; a single-stop shortcut records both transitions. **Dependency:** 2c and media/OTP contracts.
- [ ] D2.2e — F22 cash collection/ledger APIs, rider balance, admin deposits/adjustments and warehouse totals. **Done:** repeat collection cannot duplicate cash, balances are atomic and append-only, each child's warehouse is preserved, adjustments require a reason. **Dependency:** 2d and agreed payment contract.

Joint gate: one COD order from customer to packing to rider delivery to deposit. Repeat with two warehouses; check stock, events, amount due, notifications and cash totals together. This gate requires real integrated APIs, not fixture-only screens.

## 3. Complete delivery and financial edge cases

- [ ] D2.3a — F18 same/different-rider split dispatch, batch stop order, pickup-before-ride checks, post-pickup handover and failed delivery resolution. **Done:** one OTP can complete the appropriate same-rider children, handover is acknowledged, return vs spoiled stock uses Dev 1 services correctly. **Dependency:** Stage 2 and reconciled transition rules.
- [ ] D2.3b — F15 mobile Razorpay checkout/UPI intent, confirming/retry UI and COD pay-link UI; F16 cancel/refund request/status and photo upload. **Done:** client success never confirms payment authoritatively; partial cancellation remains per child; refund status comes from server. **Dependency:** D1.3a/3b.
- [ ] D2.3c — F22 reconciliation views for overpaid/unmatched collections and UPI; integrate paid updates into rider UI. **Done:** online payment shows “Already paid — do not collect”; recorded extra cash is retained and sent to refund review, never silently discarded. **Dependency:** D1.3c and cash ledger.

Verification: assignment-vs-reassignment, duplicate deliver/collect, separate riders sharing a group OTP, cancelled child, failed delivery return/wastage, mixed-warehouse deposits and online payment racing collection.

## 4. Offline resilience and Phase 2

- [ ] D2.4a — F21 rider pickup bundle, durable SQLite outbox, encrypted sensitive payloads, sequence-ordered batch sync and per-event applied/duplicate/conflict results. **Done:** restart preserves pending events; replay applies each effect once; reassigned/cancelled events remain inspectable, with unmatched cash preserved. **Dependency:** stable delivery/payment contracts. Design event IDs and payloads in Stage 0 even though implementation is here.
- [ ] D2.4b — Offline OTP gate and server re-verification, attempt cap, GPS/device-time flags, review queue, shift-end sync block and local media cleanup. **Done:** airplane-mode delivery syncs safely; wrong OTP/conflicts are reviewed under an explicit server policy; no success message is sent before authoritative processing. **Dependency:** 4a and Dev 1 OTP/media/notification services.
- [ ] D2.4c — F15 local warehouse UPI QR and F22 bank verification workflow. **Done:** zero-network QR uses correct warehouse VPA/amount; UPI remains unverified until reconciled and is excluded from cash in hand. **Dependency:** 4a/4b, business VPA confirmed, D2.3c.
- [ ] D2.4d — F20 cached Routes ETA service, rider pings/buffering, batch ETA, private tracking APIs, expiring public link, customer/admin maps and public tracking web page. **Done:** no other customer stops leak, location appears only after pickup, stale timestamps are visible and polling stops appropriately. **Dependency:** delivery events/geography; baseline fallback ETA already supplied for Stage 2 with Dev 1.
- [ ] D2.4e — F21 customer MMKV cache, optimistic mutation persistence, delta/tombstone/full-resync integration and upload recovery. **Done:** warm home meets documented under-one-second target on representative hardware; network loss preserves cart and makes stale prices visible; reconnect does not duplicate checkout. **Dependency:** D1.4d and Stage 2.
- [ ] D2.4f — Customer F07 Notify Me, F12 coupons/banners, F17 preorder slots and rain/night notices; notification preferences/deep links. **Done:** UI follows server validation, coupon errors/capacity exhaustion are handled, notifications open the correct screen. **Dependency:** matching D1.4a–4c APIs; build each independently as it lands.
- [ ] D2.4g — F25 delivery dashboard/reports: rider activity/shifts, cash/reconciliation, offline reviews and promised-vs-actual delivery metrics. **Done:** scoped admin visibility and totals agree with underlying ledger/orders; CSV reporting works. **Dependency:** stable delivery records; coordinate dashboard composition with Dev 1.

Offline gate: verify complete pickup → airplane mode → arrival/OTP/cash → process restart → reconnect → repeated sync. Also cover paid-online while offline, reassign while offline, corrupted/rejected event, pending photo, exhausted OTP attempts and stale location. Queue conflicts must have an operational resolution path.

## 5. Pilot and release

- [ ] D2.5a — Device acceptance: permission denial, locked screen, killed/background app, reconnect, weak network, update/maintenance behavior, accessibility and low-end Android performance. Cover customer iOS separately. **Done:** observed results and known limitations are recorded with reproducible checks.
- [ ] D2.5b — Release customer builds and signed rider APK through agreed distribution; document install, update, permission and recovery steps for six riders. **Done:** clean install and upgrade retain required local state securely.
- [ ] D2.5c — With Dev 1, rehearse opening, packing, dispatch, failure/handover, cash deposit, bank reconciliation, manual refund and closing on staging. **Done:** no unexplained stock/cash/payment discrepancies, no unresolved blocking sync conflicts; owner confirms operating settings.

Treat Stage 2–3 as an integrated controlled MVP. The documented dead-spot delivery promise requires Stage 4 offline acceptance before general hill-region rollout. Any earlier operational pilot needs an explicitly agreed limitation and recovery procedure.

## Coordination rhythm

At each day's start identify the next API contract and dependency; at day's end demo the smallest integrated path. Dev 1 hands off endpoints, example payloads, errors and test fixtures; Dev 2 reports integration gaps and provides delivery events/results back. Review each other's financial and permission changes. Keep PRs feature-sized; do not wait for a whole stage to merge. If blocked, take another independent checkbox in the same stage, not an unrequested Phase 3 feature.

No app code, automated tests or device runs were created/performed for this planning task. External service access, real hardware behavior and business/tax/retention decisions remain to be validated during implementation.
