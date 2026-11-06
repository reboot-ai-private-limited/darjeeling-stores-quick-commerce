# Team split and working agreement (Dev 1 and Dev 2)

Status: Proposed, 2026-11-05. Personal plans: [Dev 1](../../dev1.md), [Dev 2](../../dev2.md). Active backend foundation checklist: [tasks/todo.md](../../tasks/todo.md). This document describes planned ownership. Only the API runtime foundation (config, errors, MongoDB lifecycle, health, boundary checks) exists in code today.

## 1. The rule that keeps both of you safe

**Every file, module and collection has exactly one owner. You change only what you own. You talk to the other side only through three things: the HTTP contract, a port, or an event.** Nothing else crosses the line, so one of you can work, merge or break a branch without touching the other's code.

| What crosses the line | Where it lives | Who may change it |
|---|---|---|
| HTTP contract (what apps and web call) | [Planned endpoints](../api/planned-endpoints.md) and the `docs/api/F??-*.md` files, plus fixtures in `packages/contracts`; implemented routes are in [docs/api/README.md](../api/README.md) | The owner of that feature; additive changes only unless both agree |
| Port (one backend module calling another) | `apps/api/src/platform/ports/*.ts` | The provider proposes, **both approve** (a "contract PR") |
| Event (something happened) | `apps/api/src/platform/events.ts` | The publisher proposes, both approve |

Because every port ships with an in-memory **fake**, the consumer never waits for the real module. Swapping fake for real is a one-line change in the consumer's own composition file.

## 2. Who owns what

| | Dev 1 — Identity, geography, orders and money | Dev 2 — Catalog, delivery, engagement and both mobile apps |
|---|---|---|
| Features | F01 auth · F02 roles · F03 zones and warehouses · F10 cart and quote · F11 fees · F12 coupons · F13 placement · F14 lifecycle · F15 payments · F16 refunds · F17 hours and pre-orders · F25 admin, settings, reports | F04 catalog · F05 offerings and stock · F06 import and tree · F07 Notify Me · F08 discovery · F09 addresses · F18 dispatch · F19 rider app · F20 ETA and tracking · F21 offline · F22 rider cash · F23 notifications · F24 media |
| Endpoints (about) | 134 | 126 |
| Apps | `apps/web` (shell, storefront, core admin) | `apps/customer-app`, `apps/rider-app`, plus their admin pages inside `apps/web` |
| Repo infrastructure | Root config, lockfile, CI, API bootstrap, `platform/` | `packages/mobile-kit`, `packages/contracts/mock-api` |

Feature IDs are the F01–F25 specifications in [docs/README.md](../README.md). Endpoint lists are in `docs/api/F??-*.md`; **route ownership follows the feature file, not the URL prefix** (for example `POST /admin/orders/:id/assign` belongs to F18, so Dev 2).

## 3. Path ownership

| Path | Owner | Rule |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `docker-compose.dev.yml`, `.github/**`, `packages/config/**`, `tasks/**` | Dev 1 | Dev 2 requests changes. See section 7 for dependencies and the lockfile |
| `apps/api/src/{server,app,container}.ts`, `config/**`, `shared/**` | Dev 1 | Frozen after the seam PR (S0); edit only with both reviewing |
| `apps/api/src/platform/**` (ports, events, fakes) | Dev 1 creates, **both approve every change** | The contract layer |
| `apps/api/src/composition/dev1.ts` | Dev 1 | Wires Dev 1 modules, routes, jobs, settings keys, indexes |
| `apps/api/src/composition/dev2.ts` | Dev 2 | Same for Dev 2 modules |
| `apps/api/src/modules/{health,identity,access,audit,settings,geography,pricing,coupons,cart,quotes,orders,payments,refunds,preorders}/**` | Dev 1 | Private; others use only `<module>.public.ts` |
| `apps/api/src/modules/{catalog,offerings,availability,discovery,addresses,media,notifications,jobs,riders,dispatch,delivery,cash,tracking,offline-sync}/**` | Dev 2 | Private; others use only `<module>.public.ts` |
| `apps/web/**` (layout, shared UI, storefront, core admin pages) | Dev 1 | |
| `apps/web/src/app/(admin)/admin/{catalog,inventory,media,notifications,riders,dispatch,cash,reconciliation,offline-reviews}/**`, `apps/web/src/app/track/**` | Dev 2 | Dev 1's layout renders Dev 2's pages through the nav file below |
| `apps/web/src/admin/nav/dev1.nav.ts` / `dev2.nav.ts` | Dev 1 / Dev 2 | Each edits only their own menu list |
| `apps/customer-app/**`, `apps/rider-app/**`, `packages/mobile-kit/**` | Dev 2 | |
| `packages/shared/src/core/**` | Dev 1 | Error codes, envelope, actor types |
| `packages/shared/src/dev1/**` / `src/dev2/**` | Dev 1 / Dev 2 | DTOs and constants for own features. The root `index.ts` only re-exports the three folders and stays untouched |
| `packages/contracts/fixtures/<feature>/**` | The feature's owner | One JSON per endpoint and case, taken from `docs/api` |
| `docs/**/F??-*.md`, `docs/api/F??-*.md` | The feature's owner | `docs/api/planned-endpoints.md` is **generated**: rebuild it with `node scripts/build-api-index.mjs`, never merge it by hand. `docs/api/README.md` describes implemented routes and stays with Dev 1 |
| `docs/engineering/mobile.md`, `docs/runbooks/delivery*` | Dev 2 | |
| Other `docs/**` | Dev 1 | |

A [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) file should mirror this table once the two GitHub handles are known (S0). Until then this table is the rule.

## 4. Collection ownership

Only the owning module reads or writes its collections. Everyone else uses its `.public.ts` or a port.

| Dev 1 | Dev 2 |
|---|---|
| `users`, `refresh_tokens`, `device_tokens`, `otps`, `roles` | `categories`, `products`, `warehouse_products` |
| `audit_log`, `settings`, `settings_history`, `sequences` | `stock_movements`, `price_history`, `stock_reservations`, `catalog_revisions`, `stock_subscriptions`, `waitlist` |
| `cities`, `localities`, `zones`, `warehouses` | `addresses`, `media_files` |
| `delivery_rules`, `coupons`, `coupon_redemptions`, `banners` | `notification_templates`, `notifications`, `jobs` |
| `carts`, `quotes`, `order_groups`, `orders`, `order_events` | `riders`, `rider_shifts`, `assignments`, `delivery_batches` |
| `payments`, `refunds` | `offline_events`, `cash_ledger`, `rider_location_trail` |

The data-model spec names a single `counters` collection. To avoid two people sharing it, Dev 1 uses `sequences` (order numbers) and Dev 2 uses `catalog_revisions` (delta-sync revisions).

Delivery changes order fields (status, collection, offline flags) **only by calling the order port**; the orders module performs the write.

## 5. Ports (backend module to backend module)

Defined in `apps/api/src/platform/ports/`. Each port has a fake in `apps/api/src/platform/fakes/`; **the provider keeps its fakes accurate**.

| Port | Provider | Consumer | What it does | Until real, the consumer uses |
|---|---|---|---|---|
| `auth` | Dev 1 | Dev 2 | Actor id, role, permissions, warehouse scope; `requirePermission(key)` | A fake actor read from a test header. **Built only in dev and test composition, never in production** |
| `identity` | Dev 1 | Dev 2 | Pre-register or deactivate a rider's user, revoke sessions, read device tokens | In-memory users |
| `geography` | Dev 1 | Dev 2 | Zone, warehouse, warehouses of a zone, zone for a point, open or paused now | Two warehouses in one zone, one in another |
| `settings` | Dev 1 | Both | Read a setting at warehouse, zone or global scope; register keys | Defaults from each registry file |
| `audit` | Dev 1 | Both | Record a sensitive action | Collects entries in memory |
| `orders` | Dev 1 | Dev 2 | Read an order; change its status through the one state machine; record a collection; verify the delivery OTP | An in-memory state machine with the legal transitions |
| `refunds` | Dev 1 | Dev 2 | Create an automatic refund (overpaid, spoiled return) | Records the call |
| `eta` | Dev 1 baseline, Dev 2 Routes version | Dev 1 | Estimate minutes for a warehouse and address | Dev 1's settings-based baseline |
| `reports` | Dev 1 | Dev 2 | Register delivery reports and dashboard widgets | Local registry |
| `stock` | Dev 2 | Dev 1 | Reserve, release and restore stock atomically; check availability | In-memory stock with the same rules |
| `catalog` | Dev 2 | Dev 1 | Resolve cart lines to current zone prices and availability | A small fixed catalog |
| `addresses` | Dev 2 | Dev 1 | Read a customer's address with its zone | In-memory addresses |
| `media` | Dev 2 | Dev 1 | Copy files onto an order, signed read URL, schedule deletion | Returns fake URLs |
| `jobs` | Dev 2 | Both | Enqueue a job, register a handler, cancel | An in-memory timer queue |
| `otp-transport` | Dev 2 | Dev 1 | Send an OTP by WhatsApp with SMS fallback | Captures the code for tests |

Ports hold **operations, not data models**. A port never exposes a Mongoose model.

## 6. Events (something happened)

An in-process bus in `platform/events.ts`; the durable work is done by jobs ([F23](../platform/23-notifications.md)).

| Event | Published by | Consumed by |
|---|---|---|
| `order.placed`, `order.status_changed`, `order.cancelled`, `order.item_unavailable` | Dev 1 | Dev 2 notifications, tracking |
| `group.paid`, `payment.late`, `payment.mismatch` | Dev 1 | Dev 2 notifications, delivery ("already paid") |
| `refund.created`, `refund.updated` | Dev 1 | Dev 2 notifications |
| `stock.zone_availability_changed`, `stock.low` | Dev 2 | Dev 2 Notify Me and alerts |
| `assignment.created`, `assignment.ack_overdue`, `assignment.reassigned` | Dev 2 | Dev 2 notifications |
| `delivery.arrived`, `delivery.completed`, `delivery.failed`, `collection.recorded`, `offline.review_flagged` | Dev 2 | Dev 2 notifications and reports |

If Dev 1 needs a new reaction to a Dev 2 event (or the reverse), propose it as a contract PR.

## 7. Shared places, made safe

| Shared place | How edits are kept apart |
|---|---|
| `container.ts` / `app.ts` | Seam PR (S0) adds one call each to `composition/dev1.ts` and `composition/dev2.ts`. After that, each dev edits only their own file |
| Settings keys | Each module has a `settings.registry.ts`, registered from its composition file |
| Mongo indexes, job handlers | A module's `ensureIndexes()` and job registration are called from its composition file |
| `packages/shared` | Three folders (`core`, `dev1`, `dev2`), one owner each |
| Error codes | `core` holds the shared ones; a feature adds its own codes in its own `packages/shared` folder, namespaced by feature |
| Web menu | Each dev edits their own nav file only |
| Route collisions | A test that lists every registered `METHOD path` fails on duplicates, so two modules cannot claim one route |
| Dependencies and the lockfile | Tell the other dev in one line before adding a package. Never hand-edit `pnpm-lock.yaml`. On a lockfile conflict: take `main`'s file, rerun `pnpm install`, commit the result |
| `.env.example` | Each dev appends variables inside their own commented block |

## 8. The seam PR (S0), done once and first

Dev 1 does it in about a day, Dev 2 reviews. **Dev 2 does not wait for it**: mobile and spike work (D2-0, D2-1) touches no shared file.

1. `platform/ports/*.ts` (types only), `platform/events.ts` with an in-memory bus, `platform/fakes/*`.
2. `composition/dev1.ts`, `composition/dev2.ts` and their hooks in `container.ts` and `app.ts`; module-level registries for settings, indexes and jobs.
3. `packages/shared` split into `core`, `dev1`, `dev2`.
4. Dependency-cruiser: modules may import only `platform/*` and another module's `.public.ts`; `platform` imports no module.
5. The duplicate-route test and a `CODEOWNERS` file.
6. `packages/contracts` skeleton with fixtures per feature.

## 9. Contracts and fixtures

`docs/api` defines each endpoint. For every endpoint the **backend owner** adds fixtures (`success`, `denied`, `invalid`, plus conflict or retry cases) under `packages/contracts/fixtures/<feature>/` taken from the doc examples, and a test that checks the real response matches its fixture shape. The **mobile and web consumers** read the same fixtures through `packages/contracts/mock-api` (a small server Dev 2 maintains) until the real endpoint exists.

- **Additive changes** (a new optional field, a new endpoint) need only a note in the PR.
- **Breaking changes** (rename, remove, change meaning or type) need a contract PR approved by the other dev, a doc update and fixtures updated together.

## 10. Git and review rules

- Branches: `dev1/<task-id>-<slug>`, `dev2/<task-id>-<slug>`. Small PRs; merge to `main` as soon as checks pass.
- Before every PR run `pnpm typecheck`, `pnpm test` and `pnpm check:boundaries`. Add `pnpm --filter @darjeeling/api test:integration` when persistence changes.
- **Review is required only for** contract PRs (ports, events, shared `core`, fixtures that change meaning), anything touching money, permissions or scope, and root or infrastructure files. Everything else merges on green checks, so nobody waits.
- Rebase on `main` at least daily. No force-push to `main`. Never reformat files you do not own.
- A PR that changes a path owned by the other dev is wrong unless it is a contract PR.

## 11. Integration gates

Gates are checkpoints where fakes are replaced by real modules. Work between gates is independent.

| Gate | Real modules involved | Proof |
|---|---|---|
| G0 | S0 seams merged | Both devs can build and run tests with only fakes |
| G1 | Dev 1 sessions, roles, geography | Both apps log in for real; an admin creates a zone and warehouse; a pre-registered rider logs in |
| G2 | Dev 2 catalog, discovery; Dev 1 geography | An admin creates stock and it shows in the customer app in the right zone only |
| G3 | Dev 1 cart, quote, orders; Dev 2 stock, delivery, cash | One COD order goes checkout, pack, dispatch, deliver, cash deposit. Repeat with a split order |
| G4 | Dev 1 payments, refunds; Dev 2 delivery, cash | Online payment racing cash collection, cancel and refund, overpaid handling |
| G5 | Dev 2 offline, tracking; Dev 1 events | Airplane-mode delivery syncs; tracking shows rider only after pickup |
| G6 | Both | Staging rehearsal of a full day: open, pack, dispatch, failure, deposit, reconciliation, refund, close |

## 12. Spec conflicts to settle (each has one owner)

Carried over from the old plan. Settle each **before** its dependent code, then record the answer in the owning feature spec.

| Conflict | Decides | Needed before |
|---|---|---|
| F10/F13 re-price changed quotes, F25 says existing quotes keep locked settings | Dev 1 (informs Dev 2 for the client) | Quote work (D1-7) |
| F03 keeps hours and timers on the warehouse, F25 also lists scoped settings | Dev 1 | Geography (D1-5) |
| Data model bans catalog hard deletes, F04/F24 allow deleting never-ordered products | Dev 2 | Catalog and media (D2-3, D2-4) |
| F05 allows price-conflict `warn`, F08 assumes one guaranteed price | Dev 2 | Offerings (D2-4) |
| F09/F21 allow placement before uploads finish, F24 copies media at placement | Both (Dev 2 media, Dev 1 placement) | Checkout (D1-7, D2-3) |
| F12 coupon release wording is broader than F16's whole-group cancel rule | Dev 1 | Coupons (D1-6) |
| F18 return and handover paths extend the F14 state diagram | Dev 1 decides legal transitions, Dev 2 requests them | Delivery execution (D2-8) |
| One group OTP shared by children, but the data model says clear it after delivery | Dev 1 | Orders (D1-8) |
| Stock compensation and status/event writes span documents (crash recovery) | Both (Dev 2 stock, Dev 1 orders) | Placement (D1-8, D2-4) |
| F20 is Phase 2 but quotes need an ETA in Phase 1 | Dev 1 baseline now, Dev 2 Routes later | Quote (D1-7) |
| Ratings labelled Phase 2 in F13 and Phase 3 in the overview | Dev 1 | Scheduling only |

Business inputs for the project owner (not for the developers to invent): hosting, domain and budget; WhatsApp and SMS provider access and template approval; packer login practice; whether a rider may also be a customer; cash deposit sign-off; business UPI ID; warehouse batching distance; retention periods; GST and invoice rules. Documented defaults stay in place until answered.

## 13. Never do

- Edit a file or module you do not own, even to "fix a small thing". Ask in a contract PR or message.
- Import another module's internals. Use its `.public.ts` or a port. The boundary check will fail the build.
- Read or write another module's collection.
- Add a second order state machine, pricing engine, auth service or job queue.
- Change a port, event or `core` type without the other dev's approval.
- Ship the fake actor or any fake into production composition.
- Hand-edit `pnpm-lock.yaml` or `docs/api/planned-endpoints.md` (rebuild the index with `node scripts/build-api-index.mjs`).
