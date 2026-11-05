# Backend foundation checklist

## JWT and dual-cookie session progress

The dev login now issues signed 15-minute access JWTs and seven-day absolute refresh-session families in host-only HTTP-only SameSite=Strict cookies. Session hashes persist in MongoDB, rotation is atomic, used-token replay revokes the family, and logout clears both cookies and revokes access. Exact-origin/custom-header checks protect refresh and cookie mutations. Browser restoration and one-time authenticated-read retry are connected, with tab-level refresh serialization. Production password/2FA login and native refresh contracts remain pending; B10 is not marked fully complete. New signing key configuration is private runtime state, with no committed key.

## Reusable authorization progress

`requirePermission` now wraps HTTP handlers with current identity, permission and target-scope checks. The development permission registry endpoint uses it. HTTP tests cover missing identity, permission denial, foreign warehouse, live scope changes and safe failure on actor lookup errors. The database-backed dev-auth case also checks role changes during an existing session. This advances B11 but does not complete production sessions, record ownership resolution or list-query scope filtering.

## Development-only OTP override

The user requested `mockOTP=true`, shared code `000000`, and development super-admin phone `9000000001`. This is a separate temporary dev path, not completion of B08–B16 production authentication. It is explicitly development-only, loopback-bound and restricted to databases ending `_dev`/`_test`; it refuses existing-account promotion. Five disposable integration tests and one environment-guard test cover the override. Production 2FA, durable sessions, refresh rotation and provider delivery remain pending. See [development auth](../docs/engineering/development-auth.md).

Status: Proposed execution plan; implementation evidence retained below
Owner: Backend maintainers
Last verified: 2026-11-05, source and documentation inspection for the F01–F03 planning expansion

The original B01–B22 checklist remains the parent tracker. The detailed slices below expand those same tasks; they are not a second backlog. Existing unchecked boxes remain unchecked until their full acceptance evidence is recorded. Historical progress notes are observations from earlier work, not new verification performed while writing this plan.

See [plan](plan.md) for architecture and decisions. Each task includes its acceptance evidence; split broad tasks into reviewable commits.

## 1. Runtime and contracts

- [ ] B01 — Freeze proposed auth/scope/settings/geography decisions and shared error envelope/request ID conventions. Paths: owning feature docs, `packages/shared/src`. Depends: none. Verify: valid/invalid request examples and explicit safe response fields reviewed.
- [ ] B02 — Add validated environment config, safe error middleware, body limits, request logging/redaction and explicit CORS/proxy config. Paths: API config/shared HTTP/app/server. Depends: B01. Verify: malformed bodies, oversized bodies, missing configuration and internal failures return safe errors without secrets.

## 2. Persistence

- [ ] B03 — Add Mongoose connection lifecycle, readiness endpoint and bounded graceful shutdown. Paths: shared DB, server, health. Depends: B02. Verify: missing/unreachable Mongo fails readiness; listener starts only after required initialization; shutdown closes connections.
- [ ] B04 — Add local replica-set Compose/init workflow and isolated integration configuration. Paths: root Compose, API test config, README. Depends: B03. Verify: fresh initialization, real write/read/index test and refusal of unsafe test database names/targets.

Checkpoint: documented startup works from a clean install; liveness/readiness have distinct tested semantics.

## 3. Module boundaries and audit

- [ ] B05 — Extract health reference module and explicit composition/router mounting; add import-boundary checks. Depends: B02. Verify: legal imports pass; temporary private/layer/cycle violations fail and are removed.
- [ ] B06 — Add redacted, append-only audit writes and permitted read contract. Paths: audit module/tests. Depends: B04/B05. Verify: sensitive mutation failure cannot silently omit mandatory audit; secrets never enter before/after payloads. Define transaction behavior explicitly.

## 4. Identity data and owner bootstrap

- [ ] B07 — Add users/roles models, indexes and permission registry/seed. Paths: identity/access modules. Depends: B04/B05. Verify: unique phone/email behavior, system role protection and seed reruns preserve edits.
- [ ] B08 — Add operator-run owner bootstrap with password hashing and required 2FA enrollment. Depends: B06/B07. Verify: no built-in credentials, duplicate bootstrap cannot overwrite an owner, incomplete enrollment cannot gain normal access.

## 5. Staff sessions

- [ ] B09 — Staff password login, lockout and expiring 2FA challenge/enrollment/verification/recovery contracts. Depends: B08. Verify: generic failure responses, wrong/expired/reused challenges, recovery authorization and secret encryption.
- [ ] B10 — JWT validation, refresh rotation/replay handling, logout/revocation and cookie/CSRF behavior. Depends: B09. Verify: simultaneous refresh, revoked/expired tokens, wrong issuer/audience, deactivated user and untrusted origin cannot authenticate.

Checkpoint: owner login works; tokens and 2FA secrets are absent from logs; invalidated sessions cannot continue.

## 6. Authorization and staff administration

- [ ] B11 — Permission middleware, resource-scope enforcement and cache invalidation. Depends: B07/B10. Verify: deny-by-default, same-permission different-warehouse denial and immediate effect of role/user changes.
- [ ] B12 — Roles/staff CRUD, permissions list and scoped audit listing, using identity-owned user writes. Depends: B06/B11. Verify: no privilege escalation, no system-role deletion, authorized edits revoke sessions as required and create audit records.

## 7. Settings

- [ ] B13 — Typed settings registry, scoped resolution, history and immediate cache refresh. Depends: B06/B11. Verify: scope precedence, forbidden scopes, invalid keys/values and concurrent updates.
- [ ] B14 — Admin settings/history endpoints and public app configuration projection. Depends: B13. Verify: unauthorized writes fail; public config never exposes secrets or internal settings.

## 8. Customer/rider authentication

- [ ] B15 — OTP transport port and provider adapters with WhatsApp-first/SMS fallback, safe timeout/failure mapping. Depends: B02/B13. Verify: fake adapter failures and fallback; record real provider sandbox evidence separately when credentials/templates are available.
- [ ] B16 — Request/verify OTP, atomic consumption, phone/IP throttling, attempt limits and preregistered rider policy. Depends: B07/B10/B15. Verify: expiry independent of TTL cleanup, concurrent verify consumes once, blocked/unknown rider responses do not disclose registration details and phone role cannot be escalated by request input.
- [ ] B17 — Profile read/update, OTP-protected phone change, account deletion request, notification preferences and FCM device registration. Depends: B16. Verify: ownership, safe field allow-list, duplicate phone rejection and no client-controlled role/scope/status mutation. Final deletion/media cleanup remains F25/F24 work.

Checkpoint: staff, customer and rider identities follow distinct supported flows; session and ownership tests pass against real persistence.

## 9. Geography

- [ ] B18 — City/locality/warehouse models and scoped list/create/update endpoints with input validation. Depends: B11/B13. Verify: valid references, one zone per warehouse, coordinates/units, stable unique warehouse codes and immutable/guarded operational reassignment.
- [ ] B19 — Zone polygon validation, overlap enforcement and location resolve/check endpoints. Depends: B18. Verify: inside/outside/boundary points, containment, self-intersection and simultaneous conflicting polygon saves with real geospatial indexes.
- [ ] B20 — Warehouse hours/pause/config validation and conservative disable guards; audit sensitive UPI/config edits. Depends: B18/B19. Verify: invalid hours/foreign scope rejected; unsafe disable/reassignment denied until authoritative dependent-module checks exist. Full order availability/preorder execution belongs to F17/F13 later.

## 10. Acceptance

- [ ] B21 — Execute the final backend journey in plan.md, run build/typecheck/fast/integration/boundary checks and smoke-test compiled startup. Depends: B01–B20. Record real commands/results; do not mark provider delivery verified using fake transport.
- [ ] B22 — Update README/env examples, module ownership map and Dev 1/Dev 2 handoff with endpoint examples, cookie/origin requirements and remaining provider inputs. Depends: B21. Verify: a fresh developer can run the backend without unpublished files or credentials.

B02 HTTP/config implementation is in place; B03 connection lifecycle is implemented. Atlas connection, readiness and graceful listener/database shutdown were verified against the supplied cluster; signal handling was not exercised on the host.

B05 progress: health routing and composition root extracted; automatic boundary enforcement and violation checks remain.

B04 progress: Compose configuration and isolated replica-set tests added; real write/read/index, transaction rollback, startup failure and readiness pass. Docker Compose runtime and POSIX signal shutdown still require a running Docker daemon and a Linux/macOS Node environment. B05 progress: automated API boundary check added and private-module, domain/infrastructure and type-only unresolved import probes rejected.

## Detailed execution slices for F01–F03

### Implementation evidence: identity persistence started

2026-11-05: B07.1 is partially implemented in `modules/identity`. User creation validates unknown input, canonicalizes phone/email, enforces partial unique indexes, persists immutable account kind separately from role and grants no warehouse access. Five new disposable Mongo integration cases cover safe projection, optional identifiers, concurrent uniqueness, invalid/injected fields and defaults. Role existence/classification enforcement, role schema/registry/seed and authorized creation orchestration remain pending; B07/B07.1 are deliberately not marked complete. No authentication endpoint is exposed or admin section enabled.

Verification: workspace typechecking and API boundary checks passed; 14 fast tests passed; full integration suite passed 12 tests with one Windows SIGTERM exclusion. API compilation passed as part of integration execution. No production database or provider was contacted.

Each entry gives dependencies, likely file areas, acceptance and verification. Sizes are relative: S is a focused change; M is several connected files. Split a slice further before implementation if it needs unrelated behaviors or more than one focused session. New module files listed below are proposed, not present today.

### Phase A: reconcile contracts and establish evidence

- [ ] **B01.1 — Reconcile current HTTP conventions.** Depends: none. Files: `docs/api/00-conventions.md`, `docs/api/README.md`, `packages/shared/src/index.ts`. Size: S. Acceptance: distinguish proposed business envelopes from probe responses; generated request IDs and error details match source; endpoint-index links resolve. Verify: compare examples against HTTP tests and check local links; no runtime behavior change required.
- [ ] **B01.2 — Finalize authentication state/transport contracts.** Depends: B01.1. Files: F01 feature/API docs and foundation plan decision register. Size: M. Acceptance: document restricted enrollment, challenge/recovery, browser/native refresh transport, replay revocation scope and OTP purpose/app binding. Verify: trace success, expiry, replay and simultaneous refresh as decision tables; identify owner decisions still blocking coding.
- [ ] **B01.3 — Finalize authority and geography contracts.** Depends: B01.1. Files: F02/F03 feature/API docs. Size: M. Acceptance: specify protected roles/targets, assignable grants, separate list/detail responses, address shape, shared-border tie and lifecycle guard behavior. Verify: review D07–D14 in the plan against every affected mutation; resolve cross-feature links to F17/F25.
- [ ] **B02–B05.1 — Verify and retain the existing foundation.** Depends: none; B01 before changes to public contracts. Files: existing runtime/config/health/tests and boundary configuration only if a check fails. Size: M verification. Acceptance: current fast/type/boundary checks pass; disposable integration results and Windows skips recorded; Docker clean initialization and POSIX termination remain explicitly pending if not runnable. Verify: execute the existing commands in plan section 7; never mark environmental skips as passes.

**Checkpoint A:** Contracts are consistent, foundational checks have named evidence and blocking product/provider inputs have owners. No empty business-module scaffold is required.

### Phase B: durable audit, accounts and owner entry

- [ ] **B06.1 — Implement redacted transactional audit writes.** Depends: B01.1, foundation verification. Files: audit public contract, application/infrastructure adapter and integration test. Size: M. Acceptance: allowed fields only; audit and sensitive mutation commit together; forced audit failure rolls back the mutation. Verify: real replica-set transaction/rollback and secret-redaction cases.
- [ ] **B07.1 — Establish account identifiers and role invariants.** Depends: B01.2/B01.3, foundation verification. Files: identity user schema, access role schema, integration fixtures/tests. Size: M. Acceptance: canonical phone/email uniqueness with optional identifiers; account classification cannot change through role naming; duplicate concurrent creation has a deterministic conflict. Verify: actual indexes, absent/null cases and concurrent inserts.
- [ ] **B07.2 — Register permissions and seed missing launch roles.** Depends: B07.1. Files: access registry/seed/public operation and tests. Size: M. Acceptance: unknown permission keys fail; system-role policy matches finalized docs; repeated seed preserves edited grants. Verify: seed twice, edit allowed values, seed again and compare; detect incompatible registry drift.
- [ ] **B08.1 — Bootstrap the first owner safely.** Depends: B06.1, B07.2, B01.2. Files: owner command, identity bootstrap action and integration test; API manifest for the actual command. Size: M. Acceptance: no built-in password or argv secret; two concurrent attempts cannot replace/create duplicate owners; only restricted enrollment authority is issued. Verify: duplicate/concurrent bootstrap and normal-route denial before enrollment.
- [ ] **B09.1 — Complete restricted 2FA enrollment.** Depends: B08.1. Files: identity enrollment action, crypto adapter, HTTP mapping and tests. Size: M. Acceptance: encrypted persisted secret, expiring purpose-bound setup authority and single successful confirmation; setup cannot grant access to ordinary admin routes. Verify: wrong/expired/reused code/challenge, missing key and plaintext/log exclusion checks.

**Checkpoint B1:** An owner can be created exactly once and reach enrolled state; no password-only enrollment credential can act as a full owner. Credential/key requirements are in the environment reference.

### Phase C: staff sessions and immediate revocation

- [ ] **B09.2 — Authenticate staff with lockout and 2FA.** Depends: B09.1. Files: identity login policy/action, route, abuse-counter adapter and tests. Size: M. Acceptance: generic invalid credentials, enforced attempt limits, required owner 2FA and no ordinary session after partial proof. Verify: account/IP limits, disabled user, correct password/wrong TOTP and repeated accepted-code behavior.
- [ ] **B09.3 — Implement audited 2FA recovery/reset transition.** Depends: B09.2 and finalized recovery policy. Files: identity recovery operations and tests; protected staff reset route wired in B12. Size: M. Acceptance: authorized recent proof, session invalidation and restricted re-enrollment; no unrestricted owner bypass. Verify: stolen/expired challenge, unauthorized reset and failed audit rollback.
- [ ] **B10.1 — Issue and validate access sessions.** Depends: B09.2. Files: identity session action, JWT adapter, middleware and tests. Size: M. Acceptance: explicit issuer/audience/algorithm/expiry, safe user projection and current session/account validity checks. Verify: tampered/wrong-issuer/wrong-audience tokens and inactive/invalidated sessions.
- [ ] **B10.2 — Rotate refresh tokens atomically.** Depends: B10.1 and D05 resolution. Files: refresh persistence/action, route and integration test. Size: M. Acceptance: hashed tokens, one successor per predecessor and documented replay-family/user effect. Verify: concurrent refresh barrier, replay, expiry, revoked family and no partial successor writes.
- [ ] **B10.3 — Support browser/native refresh and logout.** Depends: B10.2, actual-origin policy for browser acceptance. Files: identity HTTP transport, CORS integration if needed, session tests and API docs. Size: M. Acceptance: browser refresh secret stays out of JSON; native token flow works; logout is idempotent and cannot revoke another actor's session. Verify: cookie attributes, CSRF/origin denial, credential clearing and previous access-session rejection.

**Checkpoint B2:** Bootstrap → enrollment → staff login → refresh → logout works against real persistence. Expired/replayed credentials fail and logout/deactivation semantics cannot be bypassed using an old access JWT.

### Phase D: access control and administrative operations

- [ ] **B11.1 — Enforce permission and ownership policy.** Depends: B07.2, B10.1. Files: access policies/public operations, authentication-to-actor mapping and tests. Size: M. Acceptance: deny by default, explicit wildcard behavior and customer/rider ownership restrictions independent of UI. Verify: permission matrix cases and forged client role/scope fields.
- [ ] **B11.2 — Enforce warehouse scope and invalidation.** Depends: B11.1, durable session-validity strategy. Files: access scope/query helpers, identity validity integration and database tests. Size: M. Acceptance: list/detail/write checks agree; role/user edits affect the next request; warehouse scope cannot authorize zone-wide writes. Verify: same permission with two distinct warehouse actors and stale authorization after edits.
- [ ] **B12.1 — Deliver role registry and role CRUD.** Depends: B06.1, B11.2. Files: access actions/HTTP, role adapter and tests. Size: M. Acceptance: protected/assigned roles cannot be deleted, grants obey finalized policy and list/detail outputs differ correctly. Verify: unknown/wildcard keys, privilege escalation and concurrent role assignment/deletion. Use a shared transaction conflict mechanism for the assignment/delete invariant.
- [ ] **B12.2 — Deliver staff creation/list/detail/edit.** Depends: B12.1. Files: access staff administration, identity public user writes, HTTP and integration tests. Size: M. Acceptance: canonical email uniqueness, allowed staff role/scope only and protected owner/self-change policy; audit commits with writes. Verify: wider-scope grants, owner assignment, unauthorized targets and failed audit rollback.
- [ ] **B12.3 — Deliver staff lifecycle and credential actions.** Depends: B12.2, B09.3, B10.3. Files: identity administrative actions, staff routes and tests. Size: M. Acceptance: deactivate/reactivate/password reset/2FA reset/force-logout follow policy and invalidate sessions as documented. Verify: old access/refresh rejection, concurrent last-owner protection and mandatory audit.
- [ ] **B06.2/B12.4 — Deliver scoped audit reads.** Depends: B06.1, B11.2. Files: audit query adapter/route and tests. Size: M. Acceptance: `audit:view` required; scope filtering cannot leak foreign records; cursor/filter validation and safe projections. Verify: two warehouse actors, all-scope owner and redacted payload assertions; no public update/delete route.

**Checkpoint C:** Owner creates restricted staff, staff is denied foreign data through both list and direct-ID access, and authority changes apply immediately. Audited writes cannot succeed without their audit event.

### Phase E: settings required by identity/geography

- [ ] **B13.1 — Implement typed settings resolution and history.** Depends: B06.1, B11.2. Files: settings registry/resolver, persistence and tests. Size: M. Acceptance: allowed-key/scope validation, warehouse → zone → global → default precedence and conflict-safe revision/history updates. Verify: invalid overrides, simultaneous updates and immediate reads after changes. Do not duplicate warehouse-owned hours/timers in settings.
- [ ] **B14.1 — Expose minimal settings administration and app config.** Depends: B13.1. Files: settings HTTP/public projection, maintenance integration and tests. Size: M. Acceptance: public app config exposes only approved fields; administration is scoped/audited; maintenance exemptions permit health and authorized recovery. Verify: secret-field exclusion, invalid version/app/platform and operator recovery during maintenance.

**Checkpoint D1:** OTP/session/geography settings have one owner and validated units. Public application config cannot expose secrets or lock out the only recovery path.

### Phase F: OTP login and customer identity

- [ ] **B15.1 — Implement OTP transport boundary and fake adapter.** Depends: B01.2, B13.1. Files: identity transport port, isolated fake, provider failure mapping and tests. Size: M. Acceptance: fake only injected into isolated tests; timeout/failure outcomes explicit; fallback preserves challenge identity. Verify: timeout, primary failure/fallback success and both-failed cases without logging the code.
- [ ] **B15.2 — Add selected provider adapters.** Depends: B15.1 and provider/template access. Files: provider infrastructure/config and sandbox procedure. Size: M per provider. Acceptance: actual WhatsApp-first/SMS fallback policy, safe errors and bounded requests; required secrets validated. Verify: official provider contract plus separate sandbox send/failure evidence. Missing credentials block this slice, not unrelated backend work.
- [ ] **B16.1 — Issue purpose/app-bound login challenges.** Depends: B15.1, B07.1, B13.1. Files: OTP action/schema, abuse-counter adapter, route and tests. Size: M. Acceptance: cryptographic code, keyed verification hash, expiry/resend supersession and atomic phone/IP caps. Verify: boundary limits, failed-send accounting, concurrent issuance and generic rider/account rejection.
- [ ] **B16.2 — Consume OTP and create/login customer atomically.** Depends: B16.1, B10.2. Files: verify action, user/session persistence integration and tests. Size: M. Acceptance: one successful consume, one customer under concurrent first login, explicit wrong-purpose/app denial and no creation for rider requests. Verify: expiry without TTL cleanup, failed-attempt races, duplicate verify and blocked/deactivated users.
- [ ] **B16.3 — Bind preregistered rider eligibility.** Depends: B16.2 and agreed delivery-owned eligibility contract. Files: identity public eligibility dependency, composition and tests. Size: M. Acceptance: active preregistered rider only; client `app` cannot change account role; unknown/deactivated/wrong-role responses follow the generic policy. Verify: fake eligibility for isolated tests, persisted preregistration in integration; no always-eligible production stub. Full F19 onboarding remains outside this plan.

**Checkpoint D2:** Customer first/repeat login, active rider login and invalid challenge cases pass with real persistence. Record provider sandbox evidence separately; an injected fake never counts as actual delivery.

### Phase G: profile and device ownership

- [ ] **B17.1 — Deliver safe profile and access projection.** Depends: B11.2, B16.2. Files: identity profile actions/routes, access projection and tests. Size: M. Acceptance: `/me` and `/me/access` expose safe fields; profile mutation is allowlisted; staff login-identifier edits follow finalized proof policy. Verify: injected role/scope/status/password fields, own-data checks and duplicate email handling.
- [ ] **B17.2 — Deliver phone change and deletion request.** Depends: B17.1, B16.1. Files: identity lifecycle actions/routes and tests. Size: M. Acceptance: new-phone OTP bound to actor and purpose; unique phone invariant and session lifecycle policy; deletion request preserves financial history. Verify: stolen challenge, concurrent phone claim, retry and blocked/deletion state behavior. Final anonymization remains F25 work.
- [ ] **B17.3 — Deliver device tokens and notification preferences.** Depends: B17.1. Files: identity device/preferences actions/routes and tests. Size: M. Acceptance: token ownership/rotation/reassignment policy, app/platform validation and preference allowlist; transactional notifications cannot be disabled through promo flags. Verify: cross-user deletion/reassignment, repeated registration/logout and safe projections. Coordinate preference routes with F23 rather than creating competing endpoints.

**Checkpoint D3:** Own-profile lifecycle and device registration work without allowing account-type, permission or scope mutation from client fields.

### Phase H: geography administration and resolution

- [ ] **B18.1 — Deliver city administration/public discovery.** Depends: B11.2, B13.1. Files: geography city schema/actions/HTTP and tests. Size: M. Acceptance: canonical name/state uniqueness, all-scope admin writes and active-only public projection. Verify: duplicates, inactive records and scoped-staff write denial.
- [ ] **B18.2 — Deliver locality administration/public discovery.** Depends: B18.1 and zone-reference policy. Files: locality schema/actions/routes and tests. Size: M. Acceptance: valid city, optional zone in the same city, coordinate/travel-minute validation and inactive-parent filtering. Verify: bad references, mismatched city/zone, unknown filter IDs and update semantics. Until zones exist, reject supplied unresolved zone references; add valid-link cases after B19.1.
- [ ] **B19.1 — Deliver validated zone CRUD with serialized writes.** Depends: B18.1, B01.3. Files: geography polygon policy, zone adapter/action, routes and integration tests. Size: M; split validation from persistence if needed. Acceptance: bounded supported polygons, shared-edge allowance, positive-area-overlap rejection and transaction conflict serialization for create/edit/re-enable. Verify: containment, identical/self-crossing/zero-area polygons and simultaneous conflicting saves.
- [ ] **B19.2 — Deliver point/locality resolution.** Depends: B18.2, B19.1. Files: geographic query/action/routes and tests. Size: M. Acceptance: exactly one input mode, enabled/unpaused semantics, stable shared-border tie and consistent `/location/resolve` versus `/zones/check`. Verify: inside/outside/edge/vertex, expired pause, inactive parent and locality-link cases against real indexed queries.
- [ ] **B18.3 — Deliver scoped warehouse CRUD.** Depends: B19.1, B11.2 and finalized address contract. Files: warehouse schema/actions/routes and tests. Size: M. Acceptance: one valid zone, unique canonical code, structured address/coordinate/timer/radius validation and scoped list/detail/update behavior. Verify: duplicates, foreign scope, invalid units and forbidden zone reassignment. All-scope authority is required for initial creation unless explicit narrower creation rules are approved.

**Checkpoint E1:** Authorized geography CRUD and deterministic location resolution work against real geospatial indexes; overlapping concurrent writes cannot both commit.

### Phase I: warehouse operation safety

- [ ] **B20.1 — Validate hours, pause and operational configuration.** Depends: B18.3, B13.1. Files: geography operational policies/actions and tests; related F17 contract only as needed. Size: M. Acceptance: explicit timezone/overnight rules, allowed pause expiry and sensitive UPI/config audit; one authoritative hours/timers store. Verify: midnight/overnight windows, expired pause, invalid radius/minutes and unauthorized changes. Full preorder scheduling remains F17 work.
- [ ] **B20.2 — Guard disable and operational reassignment.** Depends: B20.1 and dependency-check contract. Files: geography lifecycle action/public port, composition and tests. Size: M. Acceptance: initial zone reassignment rejected; disable only when authoritative order/rider checks permit it; absent checks return explicit guarded rejection. Verify: active dependency, unavailable dependency and concurrent new dependency behavior. Future owning modules must participate in a shared consistency protocol before a successful safe-disable path can be claimed.

**Checkpoint E2:** No available route can bypass warehouse lifecycle protection. Missing future order/rider modules reduce available operations rather than weakening safety.

### Phase J: integration, evidence and handoff

- [ ] **B21.1 — Execute integrated foundation acceptance.** Depends: all applicable B06–B20 slices. Files: integration journey test/fixtures and recorded evidence. Size: M. Acceptance: owner bootstrap/enrollment/login → restricted staff → geography → scoped denial → settings → customer OTP → resolution → revocation; failure cases preserve invariants. Verify: compiled API plus isolated replica set, repeated run and explicit provider/OS limitations.
- [ ] **B21.2 — Run release checks and negative boundary probes.** Depends: B21.1. Files: test/check configuration only if failures require it. Size: M verification. Acceptance: fast/integration/type/build/boundary checks pass; intentional private/layer/type-import violations fail and are removed; POSIX termination has actual evidence. Verify: commands in plan section 7 and clean Git diff for removed probes.
- [ ] **B22.1 — Update current references and API inventory.** Depends: each landed slice; final closure after B21.2. Files: owning feature/API docs, handbook, `.env.example`, README and developer handoff. Size: M per coherent documentation slice. Acceptance: implemented versus proposed status accurate, every new variable classified, route examples/schema match and no hidden bootstrap/provider setup steps. Verify: clean-clone walkthrough, local links, safe examples and endpoint table versus mounted routes.

**Final acceptance:** Record command, revision, environment, result, skips and unresolved external inputs. Parent tasks become complete only when their child acceptance cases and evidence are complete. Code completion, actual provider delivery and production operational readiness are separate outcomes.

B01.1 evidence: reconciled proposed business envelopes and client request-ID wording with implemented probe and middleware behavior; confirmed referenced API documents exist. Parent B01 remains open pending B01.2 and B01.3.

B06.1 progress: added transaction-required audit writer with strict metadata fields and disposable replica-set tests for commit, validation-failure rollback and rejection outside a transaction. Audit reads, reason/before/after policy, integration with real sensitive mutations, and forced persistence-failure rollback remain open.
