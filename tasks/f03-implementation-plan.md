# F03 implementation plan: cities, localities, zones and warehouses

Status: prepared for review, 2026-11-06. Planning only; implementation has not started.
Parent design: [foundation plan](plan.md). Execution tracker: [todo.md](todo.md#f03-implementation-checklist--2026-11-06). Refines B18-B20 and D1-5 without discarding older unchecked work.

## 1. Outcome and current baseline

Deliver the 18 routes in [API F03](../docs/api/F03-zones-and-warehouses.md), an authoritative geography public interface, and the F03 admin screens required by [Dev 1 D1-5](../dev1.md). Track backend completion separately from browser acceptance and production geography setup.

Current source has no geography module, geography routes, production geography models or F03 screens. Admin navigation still disables Zones/Warehouses. F01/F02 supply persisted sessions, permission keys, staff/role management and transaction-required audit writes. Staff grants already validate IDs against the `warehouses` collection; real geography will make those records available. Reuse this foundation.

The existing `WarehouseDirectory` consumed by offerings has `get(id) -> {id, zoneId, isEnabled} | null`. `composition/dev1.ts` currently supplies health routes only. `container.ts` checks duplicate routes and accepts precomposed Dev 2 routes. Catalog/offerings still default to deny-all authentication, so merely adding geography will not activate their live routes. There is no generic platform ports file to reuse: introduce only the geography public operations actually needed.

The working tree contains the completed F01 change and an existing generated web tsbuildinfo modification. Preserve these; isolate F03 implementation changes when work begins. Historical baseline statements in the parent plan/dev1 docs are stale and must not be treated as source evidence.

## 2. Source map and feature boundaries

| Sources reviewed | Governs this plan |
| --- | --- |
| [F03 feature](../docs/foundation/03-zones-and-warehouses.md), [API F03](../docs/api/F03-zones-and-warehouses.md) | Model, 18 routes, polygons, localities, warehouse rules and screens |
| [Overview](../docs/00-overview.md), [API conventions](../docs/api/00-conventions.md), [endpoint index](../docs/api/planned-endpoints.md) | One zone per warehouse, errors, envelopes and list metadata |
| [Dev 1](../dev1.md), [team split](../docs/engineering/team-split.md), [foundation plan](plan.md), B18-B20 in [todo](todo.md) | Ownership, geography interface, lifecycle safety and D1-5 delivery |
| [F02 API](../docs/api/F02-roles-and-permissions.md), [staff setup](../docs/engineering/staff-authentication.md) | Current actors, scoped authority, sessions and browser CSRF |
| [F05 API](../docs/api/F05-warehouse-stock-and-pricing.md), [F06 API](../docs/api/F06-product-import-and-admin-tree.md) | Warehouse/zone IDs used by stock, same-zone pricing and import; no stock transfers |
| [F08 API](../docs/api/F08-discovery-and-location.md), [F09 API](../docs/api/F09-addresses.md) | Resolve before browsing; outside-zone addresses remain saveable; store status is separate |
| [F10 API](../docs/api/F10-cart-and-quote.md), [F11 API](../docs/api/F11-delivery-fees-and-surcharges.md), [F13 API](../docs/api/F13-order-placement-and-split-orders.md), [F14 API](../docs/api/F14-order-lifecycle-and-packing.md) | Consumers of zone/warehouse eligibility, priorities and lifecycle guards |
| [F17 API](../docs/api/F17-hours-preorders-and-ops-mode.md), [F17 feature](../docs/orders/17-hours-preorders-and-ops-mode.md) | Hours/preorder/ops ownership; their separate routes are not part of the 18 |
| [F18 API](../docs/api/F18-dispatch-and-assignment.md), [F19 API](../docs/api/F19-rider-app.md), [F20 API](../docs/api/F20-eta-and-live-tracking.md), [F22 API](../docs/api/F22-rider-cash-and-settlement.md) | Rider-zone membership, pickup location/radius, ETA fallback, warehouse UPI ownership |
| [F25 API](../docs/api/F25-admin-panel-settings-and-reports.md), [F25 feature](../docs/platform/25-admin-panel-settings-and-reports.md) | Settings overlap, audit and admin screens |
| [Module dependencies](../docs/architecture/module-dependencies.md), [integrations](../docs/architecture/integrations.md), [frontend architecture](../docs/engineering/frontend-architecture.md), [testing](../docs/engineering/testing.md) | Public module boundaries, map integration and verification limits |

Core backend milestone: exactly 18 F03 routes. Admin milestone: cities/localities management, zone list/map editor and scoped warehouse list/editor. F17 routes for hours, preorder slots, ops pause/resume/rain, F08 store status/waitlist, F11 fees, rider onboarding, UPI mutation and dynamic F25 settings remain separately tracked. Do not silently count these as F03 endpoints or implement their entire features here.

## 3. Endpoint traceability

All paths below are under `/api/v1`. Each task includes its necessary validation, persistence and HTTP tests.

| # | Method/path | Task | Authority and acceptance |
| --- | --- | --- | --- |
| 1 | POST /location/resolve | F03-07 | Public; point XOR locality, deterministic resolution |
| 2 | POST /zones/check | F03-07 | Public; exact same action/output as resolve |
| 3 | GET /cities | F03-02 | Public; active cities, `meta.count` |
| 4 | GET /localities | F03-06 | Public; required cityId, active locality and city |
| 5 | GET /admin/cities | F03-02 | zones:manage + all scope; includes inactive |
| 6 | POST /admin/cities | F03-02 | zones:manage + all scope; canonical uniqueness |
| 7 | PUT /admin/cities/:id | F03-02 | zones:manage + all scope; audited patch |
| 8 | GET /admin/localities | F03-06 | zones:manage + all scope; optional cityId filter |
| 9 | POST /admin/localities | F03-06 | zones:manage + all scope; valid city/optional zone |
| 10 | PUT /admin/localities/:id | F03-06 | zones:manage + all scope; cross-city integrity |
| 11 | GET /admin/zones | F03-04 | zones:manage + all scope; polygon/pause projection |
| 12 | POST /admin/zones | F03-04 | zones:manage + all scope; serialized overlap check |
| 13 | GET /admin/zones/:id | F03-04 | zones:manage + all scope; 404 unknown |
| 14 | PUT /admin/zones/:id | F03-05 | zones:manage + all scope; edit/re-enable same invariant |
| 15 | GET /admin/warehouses | F03-08 | warehouses:view; filter by actor scope, zoneId/isEnabled |
| 16 | POST /admin/warehouses | F03-09 | warehouses:manage + all scope; unique uppercase code |
| 17 | GET /admin/warehouses/:id | F03-08 | warehouses:view; foreign scope is 403 per F03 |
| 18 | PUT /admin/warehouses/:id | F03-10 | warehouses:manage + target scope; guarded disable |

## 4. Reconciled contract decisions (F03-01 completed)

These implementation contracts are reconciled and recorded in [API F03](../docs/api/F03-zones-and-warehouses.md) and [Foundation F03](../docs/foundation/03-zones-and-warehouses.md):

- Transport IDs: Real Mongo ObjectId strings (24-char hex) in transport; example `city_1`/`zone_1`/`wh_1` values are documentation placeholders. Preserve `data`, list `meta.count`, request UUID and documented error codes. Ignore unknown query parameters per conventions; strictly reject unknown mutation fields. Invalid IDs/filters must never broaden a query.
- Scoped authority: Cities, localities and zones require `all: true` scope as well as `zones:manage`. Warehouse grants confer no zone-level authority. Warehouse creation requires `all: true` scope and `warehouses:manage`. Scoped warehouse listing filters by actor's assigned warehouse IDs; foreign warehouse detail returns `403 FORBIDDEN` per F03.
- Pause authority: Updating `pause` on zone or warehouse PUT requires `ops_mode:manage` in addition to the route's primary management permission (`zones:manage` or `warehouses:manage`). Expired pauses are evaluated as inactive at read time; no background cleanup job is required for correctness.
- Warehouse address: Retained as a bounded non-empty string (`min(3).max(500)`), matching both API examples. Reconciled with foundation data model (not an unstructured embedded object without contract).
- Immutability: Warehouse `code` and `zoneId` are immutable on PUT. Zone `cityId` is immutable on PUT. A locality can move city only when its resulting optional zone link belongs to that city; allow explicit `null` to clear optional links/fallback values. Canonical city name/state is unique; locality names are unique per city. Exact length/numeric limits recorded below.
- Supported polygon geometry: Exactly one closed outer ring, `[lng, lat]` coordinates order, finite latitude [-85, 85] and longitude [-180, 180] bounds, at least 3 distinct vertices (minimum 4 coordinate pairs), maximum 1,000 vertices, no holes/MultiPolygon, no duplicate nonclosure vertices, positive non-zero area, and no self-intersections. Antimeridian crossing is rejected.
- Overlap invariant: Enabled zones must have zero positive-area overlap across all cities. Shared edges and vertices are allowed. Paused zones still reserve their geometry. Disabled zones may overlap; enabling one reruns the serialized overlap check. Identical polygons and containment count as overlap.
- Deterministic location resolution: Resolves enabled zones under active cities. Lowest stable zone ObjectId string wins on a shared border before pause evaluation, so repeated calls remain deterministic. `deliverable` reflects geographic serviceability.
- Locality resolution precedence: Active locality and city required; unknown/inactive locality returns 404. If the locality has an explicit `zoneId`, checks that zone: if enabled, resolves to it; if disabled, returns `{ deliverable: false }` (does not fall back to point). If the locality has no explicit `zoneId`, resolves its stored `{ lat, lng }` point against enabled zones.
- Warehouse location: Stored as GeoJSON Point internally; exposed as `{ lat, lng }` DTOs. Coordinates are not required to lie strictly within the served zone polygon.
- Timers, radius, and hours: Warehouse records maintain `packMinutes`, `riderArrivalMinutes`, `defaultTravelMinutes`, `priority`, and `punchInRadiusMeters`. Missing open-hours configuration is represented as unknown/not order-eligible; never invent a 24-hour opening schedule. Real operating hours belong to F17.
- Guarded warehouse disable: Disabling a warehouse requires authoritative dependency checks for active orders and active riders. If unavailable, return `409 CONFLICT` with documented `reason: "dependency_check_unavailable"`. If active orders exist, return `409 CONFLICT` with `details.activeOrders`. Ordinary edits without changing `isEnabled` to `false` succeed even when disable is guarded.
- Non-writable fields: Vendor ID and UPI are not writable F03 API fields and are not invented or defaulted to fake credentials.

## 5. Architecture and persistence

Introduce `apps/api/src/modules/geography` as behavior lands: domain validation/geometry, application actions with only real dependency ports, infrastructure Mongo adapters, interface HTTP schemas/routes, and `geography.public.ts` as the composition/export boundary. Reuse installed Express/Mongoose/Zod, audit writer and session/cookie helpers. Domain code imports no Express/Mongoose; interface does not import infrastructure. No new queue, Redis service, generic repository framework or empty layer templates.

Collections: cities, localities, zones, warehouses, plus one stable geography serialization/version record. Indexes: canonical city name/state uniqueness; locality city/name and sort lookup; zones polygon 2dsphere and city/enabled lookup; warehouses unique canonical code, zoneId and location 2dsphere. Validate/index disposable fixtures before changing production initialization; never auto-rewrite existing warehouse fixtures/documents into guessed values.

Every mandatory mutation and its safe audit metadata commit in the same replica-set transaction. Authenticate and recheck current staff permission/scope within mutation consistency boundaries, using the existing session/user lock pattern. Audit uses allowlisted fields; warehouse events include warehouseId. City/zone-wide events must not appear in restricted warehouse-only audit results. Extend strict audit payload schema only for explicit necessary snapshots, with redaction tests.

Serialize all geometry-changing paths by updating the same durable version record before candidate reads, overlap checks and save. Use this protocol for create/edit/re-enable, not a process-local lock. Run Mongo's supported transaction retries under a bounded overall request policy. Synchronize reference validation/parent state changes so a concurrent locality or warehouse write cannot commit an invalid parent relationship. Establish a consistent lock order for geometry, parent/user and target records to avoid avoidable conflict loops.

Public geography operations: get zone, get warehouse, list warehouses of zone and resolve location; safe DTOs, no HTTP dependency. Expose pause evaluation and explicit operating-status availability. Adapt to the existing offerings WarehouseDirectory structurally from Dev 1 composition without importing Dev 2 private modules or editing composition/dev2.ts. Real hours/open-now calculation is an F17 prerequisite; any absent provider/status remains explicit and cannot authorize checkout.

## 6. Ordered tasks

Each task is one focused slice, normally 3-5 files. If a slice exceeds that, split it before implementation. Checks run against isolated disposable replica sets, never the private operational database.

### F03-01 ? Reconcile contracts and fixtures
Description: settle section 4 defaults in F03/API and cross-feature references; define bounded inputs and a shared fixture vocabulary.
Acceptance: (1) all 18 routes map to tasks; (2) address, border/locality, pause authority, disable and operating-status decisions are explicit; (3) fixture actors/cities/zones/warehouses are synthetic and isolated.
Verification: compare route tables and source references; review JSON shapes and error examples.
Dependencies: none. Files: F03 feature/API, this plan, fixture definition. Scope: M.

### F03-02 ? City create/list/update and public picker
Description: ship four city routes through schema, service and HTTP integration.
Acceptance: (1) canonical name/state duplicates return 409; (2) public reads exclude inactive cities; (3) all-scope permission/CSRF and transactional audit protect writes.
Verification: city HTTP tests including invalid input, current permission loss, duplicate race and failed audit rollback.
Dependencies: 01. Files: geography city persistence/actions/routes, integration test. Scope: M.

### F03-03 ? Geometry validation policy
Description: prove supported polygon semantics before using them to authorize zone saves.
Acceptance: (1) all invalid forms in section 4 reject consistently; (2) shared boundaries are allowed while containment/identical/crossing overlap is detected; (3) chosen library agrees with Mongo fixtures on boundary cases.
Verification: pure geometry tests plus a focused real-index compatibility test; inspect official dependency docs during implementation.
Dependencies: 01. Files: geometry policy, tests, package manifest/lockfile only if needed. Scope: M.

Checkpoint A: contracts, city slice and geometry fixture corpus pass API typecheck/build and boundary checks.

### F03-04 ? Zone create/list/detail
Description: persist valid zones under existing cities and expose three routes.
Acceptance: (1) indexes initialized and safe DTOs returned; (2) overlap check/write/audit are one serialized transaction; (3) unauthorized/scoped writes cannot change geography.
Verification: containment, duplicate polygon and cross-city overlap; two concurrent conflicting creates produce one winner; audit failure leaves no zone.
Dependencies: 02,03. Files: zone store/actions/routes, integration test. Scope: M.

### F03-05 ? Zone edit, re-enable and pause
Description: add zone PUT using the same geometry protocol as create.
Acceptance: (1) edits/re-enable cannot bypass overlap protection; (2) name/enabled/pause patches respect authority and expiry; (3) parent/dependent integrity and immutable cityId hold.
Verification: concurrent edit/create and two re-enables; expired/open-ended pause; forbidden pause authority; unavailable operational dependency guard.
Dependencies: 04. Files: zone policy/action/routes/test, targeted contract update. Scope: M.

### F03-06 ? Locality administration and public picker
Description: ship four locality routes with optional same-city zone links.
Acceptance: (1) valid coordinates/fallback minutes/sort order and references; (2) inactive city/locality filtered publicly with deterministic ordering; (3) updates/clear operations preserve cross-city integrity under concurrency.
Verification: city filter, missing references, mismatched zone, inactive parents and reference/update race tests.
Dependencies: 02,04. Files: locality persistence/actions/routes, integration test. Scope: M.

Checkpoint B: all city/locality/zone routes pass isolated integration tests; overlapping concurrent geometry saves cannot both commit.

### F03-07 ? Point/locality resolution and alias
Description: serve both public resolve routes through one action.
Acceptance: (1) point XOR locality and documented 200/400/404 shapes; (2) enabled/active/pause/link rules apply identically to both routes; (3) border/vertex ties are stable and no internal warehouse data leaks.
Verification: actual 2dsphere queries for inside/outside/edge/vertex, adjacent zones, linked/unlinked locality, disabled city/zone and expired pause.
Dependencies: 05,06. Files: resolver action/query/routes, integration test. Scope: M.

### F03-08 ? Scoped warehouse reads
Description: introduce warehouse persistence and list/detail projections with safe existing-fixture handling.
Acceptance: (1) list intersects actor scope and requested filters; (2) direct foreign detail is 403 and unknown ID is 404; (3) fresh account/session/role state is enforced on each request.
Verification: two actors with identical permissions and different scopes; invalid filter cannot broaden results; post-revocation denial.
Dependencies: 04. Files: warehouse schema/store/read routes, integration test. Scope: M.

### F03-09 ? Warehouse creation
Description: create a warehouse under one existing zone using the documented API shape.
Acceptance: (1) all-scope authority and canonical unique uppercase code; (2) coordinates/address/timer/radius validation with no invented operating config; (3) zone/reference checks and audit commit atomically.
Verification: duplicate-code race, missing zone, rejected extra/code fields on inappropriate operations, failed audit rollback; created IDs usable by F02 scope grants.
Dependencies: 08. Files: warehouse creation action/schema/routes, integration test. Scope: M.

### F03-10 ? Warehouse edit and safe disable
Description: implement allowlisted updates and explicit lifecycle dependency protection.
Acceptance: (1) scope and pause authority cannot be bypassed; (2) code/zone reassignment rejected; (3) active or unavailable dependencies block disable, with audit rollback protecting failures.
Verification: foreign scope, immutable fields, active/unknown/confirmed-safe dependency outcomes and concurrency protocol tests; verify ordinary edits still work when disable is guarded.
Dependencies: 05,09. Files: warehouse mutation/lifecycle policy, dependency contract, routes/test. Scope: M.

Checkpoint C: all 18 F03 routes are mounted exactly once; full backend security/concurrency matrix passes. Backend completion does not mean unsafe disable or real hours support is available.

### F03-11 ? Compose authoritative geography reads
Description: wire public routes without JWT, protected routes only with real authentication, and provide current geography reads to composition consumers.
Acceptance: (1) both mock and nonmock startup paths mount geography correctly; (2) existing offerings directory shape is satisfied without private imports; (3) absent operating-hours/dependency adapters fail conservatively and duplicate-route checks still pass.
Verification: compiled process startup, route inventory, current F01/F02 regression and contract tests; explicitly record catalog/offerings authentication wiring status rather than claiming this feature enables all Dev 2 routes.
Dependencies: 07,10. Files: geography.public.ts, composition/dev1.ts, server.ts/container.ts as needed, lifecycle/contract tests. Scope: M.

### F03-12 ? Admin cities/localities screens
Description: add real-data lists and create/edit forms using the existing admin session client and styling.
Acceptance: (1) permission-aware navigation/forms; (2) city/zone selection, active flags and server errors are usable; (3) loading/empty/error/focus states are accessible and no fake operating records are shown.
Verification: web build/typecheck and browser create/edit/inactive picker flow, including denied staff session.
Dependencies: 06,11. Files: admin page/navigation, city/locality components, existing CSS. Scope: M.

### F03-13 ? Admin zones map/editor
Description: provide zone list/detail and polygon editing with server validation errors.
Acceptance: (1) draw/edit supported polygon with correct lng/lat round trip; (2) show overlap target and invalid polygon details without losing the draft; (3) pause/enable controls reflect authority and current server result.
Verification: real browser map draw/save/edit, invalid overlap, keyboard/form behavior and session expiry; a GeoJSON textarea alone does not count as the specified map editor.
Dependencies: 05,11. Files: zones component/map adapter, admin navigation/CSS and web dependency config only if necessary. Scope: M; split map integration from form slice if larger.
Map provider: existing architecture proposes Google Maps but there is no installed editor/provider configuration. Select the smallest suitable editor using official docs during this slice; production tiles/keys/licensing must be configured explicitly. Do not invent credentials or treat a missing basemap as a verified production map.

### F03-14 ? Admin warehouses screens
Description: ship scoped warehouse list/detail/create/edit, including zone lookup and documented configuration fields.
Acceptance: (1) all-scope users can create; scoped users see/edit only permitted targets; (2) address, coordinates, priority, timer/radius and pause errors are clear; (3) guarded disable explains why it failed and no F17/UPI controls imply implemented routes.
Verification: browser owner create/edit, scoped staff denial, code conflict and dependency-blocked disable; responsive form and keyboard checks.
Dependencies: 10,11. Files: warehouse components, admin navigation/CSS, session-client types if needed. Scope: M.

### F03-15 ? Acceptance, route inventory and handoff
Description: verify backend and UI milestones independently and update implemented/proposed references.
Acceptance: (1) all 18 handlers have positive/negative HTTP evidence; (2) owner creates city/zone/locality/warehouse, customer resolves and scoped staff is denied foreign data; (3) docs disclose remaining F17/provider/business-input limits and no unrelated task is marked complete.
Verification: commands below, browser evidence, local documentation links and automated route-table comparison against mounted methods/paths.
Dependencies: 11-14 for complete feature; backend checks can run after 11. Files: integration journey/route tests, F03/API inventory and engineering references, tracker. Scope: M; split docs from acceptance if needed.

## 7. Verification and completion gates

- Pure policy tests: coordinate bounds, ring closure, duplicate points, self-crossing, nonzero area, unsupported shapes, numeric limits, canonicalization and pause expiry with controlled clocks.
- Mongo HTTP tests: unique indexes, geospatial indexes and queries, simultaneous overlapping creates/edits/re-enables, parent-reference races, same permissions/different warehouse scopes and mandatory audit rollback.
- Transport tests: unauthenticated 401, wrong permission/scope 403, browser CSRF/origin policy, immutable/extra-field rejection, invalid filters and exact alias output. Public projections must not expose operational/private fields.
- Journey: real owner session -> create city and nonoverlapping zones -> create warehouse/locality -> grant existing warehouse to staff -> inside/outside/border/paused resolve -> foreign warehouse denial -> revoke session -> subsequent access denied. Use test credentials only.
- Browser: real create/edit/map flows, server error handling, loading/empty states, keyboard and responsive layout. Record unavailable browser infrastructure as unverified, not a pass. Mobile apps are still reserved directories; mobile acceptance is a separate G1 dependency. Before future mobile test authoring, explore a runnable app/device using ARTEMIS per AGENTS instructions.

Commands from root, using current scripts:

```powershell
pnpm --filter @darjeeling/api test
pnpm --filter @darjeeling/api test:integration
pnpm --filter @darjeeling/api typecheck
pnpm --filter @darjeeling/api check:boundaries
pnpm --filter @darjeeling/web typecheck
pnpm --filter @darjeeling/web build
git diff --check
```

`test:integration` builds the API before process tests. Run focused geography tests after each slice; run the full suite at checkpoints affected by shared code and at final acceptance. Record OS-specific skips separately. Do not delete/skip a failing check to claim completion.

## 8. Risks and remaining inputs

| Risk/input | Handling |
| --- | --- |
| Geometry library and Mongo boundary semantics differ | Prove both with the same fixtures before writes land; geometry writes share one durable lock |
| Address/locality precedence/ops permission docs conflict | Proposed defaults above; resolve and document in 01, before dependent behavior |
| Order/rider services absent | Guard unsafe lifecycle operations; no permissive fake in production; future services need a shared write protocol |
| Full F17 and dynamic settings unfinished | Keep geography serviceability distinct from operational availability; do not block basic city/zone work on unrelated F25 UI |
| Real city/locality/polygon/warehouse values absent | Synthetic test fixtures only; operator supplies live records and actual operating numbers |
| Map provider setup absent | Track browser map/editor separately from 18 backend handlers; obtain explicit provider setup before production use |
| Existing planning prose/checklists stale | This plan establishes current baseline; preserve older task state and update completion only with evidence |

No runtime code, dependencies, private credentials or operational data are changed by this planning task. Next implementation slice is F03-01, followed by cities and geometry validation.
