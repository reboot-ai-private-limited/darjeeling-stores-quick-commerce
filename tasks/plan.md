# Backend foundation implementation plan

Status: proposed, 2026-11-05. Execution checklist: [todo.md](todo.md). This refines [Dev 1](../dev1.md) foundation work; no business implementation is included in this planning change.

## Scope and baseline

The original baseline was a minimal Express health scaffold. The working tree now includes validated configuration, safe HTTP middleware, MongoDB lifecycle/readiness, local replica-set configuration, disposable integration tests, health module composition and dependency checks. Authentication, authorization, settings, audit and geography remain planned. See [current architecture](../docs/architecture/overview.md) and [testing](../docs/engineering/testing.md) for current behavior and verification limits. This plan retains proposed work and is not a release-completion record.

Build F01 authentication, F02 permissions/staff and F03 geography, plus the minimum F25 settings/audit and F23 OTP transport needed by those features. Keep one API instance, MongoDB/Mongoose, TypeScript and Zod. Retain current pnpm commands and `packages/shared`; no Redis or BullMQ. Exclude storefront/mobile screens, catalog, checkout, delivery, media and full notification jobs from this increment.

## Architecture

Use `src/config/env.ts`, `src/shared/{db,http,logging}`, `src/modules/{health,identity,access,settings,audit,geography}`, and explicit `container.ts` / `routes.ts`. Keep `app.ts` independent of listening and connecting to Mongo. Introduce module folders as their first behavior lands, not empty class templates.

Each business module exposes `<module>.public.ts`; domain logic must not import Express/Mongoose. Application actions use small ports where real database/provider dependencies exist; adapters live in infrastructure and HTTP validation/mapping in interface. Pure operations remain functions. Enforce cross-module and layer imports with dependency checks, including relative and type-only imports.

Data owners: identity owns users, OTPs, refresh/device tokens; access owns roles; geography owns cities/localities/zones/warehouses; settings owns overrides/history; audit owns audit_log. Identity owns user writes, including staff edits. Access evaluates supplied actor identity and scope without importing identity internals. Wire cross-module operations in the container; avoid F01/F02's documentary circular dependency becoming a code cycle.

## Proposed decisions before coding

- Maintain one role per phone/account; rider/customer dual use remains unsupported.
- Seed roles idempotently; never overwrite administrator-edited permissions on ordinary startup. Bootstrap the first owner through an explicit command with operator-supplied credentials, no demo password.
- Admin uses short-lived access tokens and an HTTP-only refresh cookie; native clients receive refresh tokens for secure storage. Restrict CORS to configured origins and enforce CSRF/origin protections for cookie-authenticated mutations. Final cookie settings depend on deployment domains.
- Require owner 2FA. Implement enrollment/confirmation, challenge expiration, replay protection and audited recovery/reset; a password-only challenge is not an authenticated session.
- Rotate refresh tokens with atomic single use and explicit token-family revocation/replay handling. Concurrent refresh behavior must be documented for clients.
- Check OTP expiry in the query, not via eventual TTL deletion. Consume successfully verified OTPs atomically; distinguish login and phone-change purposes. Never log or return OTPs in production. Inject a fake transport only in isolated tests.
- Zone-level mutations require all-scope access initially; explicit zone grants are deferred because the specified user scope only models warehouses. Individual warehouse scope does not confer zone-wide authority.
- Settings resolve warehouse → zone → global → default only for keys whose registry permits those scopes. Keep warehouse hours/timers on warehouse records for F03, and reconcile the duplicate F25 registry entries before implementation.
- Reject positive-area zone overlap; permit shared boundaries with deterministic point-on-boundary resolution. Serialize geometry mutations across instances of the write operation so concurrent saves cannot bypass the check. Test containment and invalid polygons, not just intersecting edges.
- Warehouse disable and zone reassignment need order/rider dependency checks once those modules exist. Until authoritative checks are wired, reject those operations conservatively; do not ship an always-false active-order stub.

Record agreed decisions in the owning specs during task 1. These are proposed technical choices, not changes already made to the requirements.

## Ordered delivery

1. Runtime/configuration and HTTP contracts.
2. Real Mongo connection/indexes and isolated integration tests.
3. Module boundaries and audit foundation.
4. Roles, users and secure owner bootstrap.
5. Staff authentication, 2FA and session lifecycle.
6. Permission enforcement and staff/role management.
7. Scoped settings and application configuration.
8. Customer/rider OTP, profile and device-token endpoints.
9. Geography administration and location resolution.
10. End-to-end backend acceptance and developer handoff.

Each numbered stage has smaller checklist entries in todo.md. Deliver tests alongside each behavior; do not build every model first and attach behavior at the end.

## Verification and handoff

Use existing `pnpm build`, `pnpm typecheck`, `pnpm test`. Add an explicit API `test:integration` script backed by an isolated disposable Mongo replica set and a guard that refuses non-test databases. Add actual lint/boundary commands rather than documenting nonexistent checks. Fast tests must not require live providers. Real integration tests cover TTL semantics, unique indexes, conditional writes, refresh replay and geospatial behavior.

Final demonstration: bootstrap owner → complete 2FA login → create scoped staff → create city/zone/warehouse → verify staff cannot access another warehouse → update a scoped setting → customer OTP login → resolve an inside/outside location → revoke session and prove subsequent access fails.

Provider sandbox OTP delivery is a separate release gate from fake-adapter tests. Database readiness must fail when Mongo is unavailable while liveness retains its existing meaning. Verify compiled API startup and bounded shutdown.

## Inputs and risks

Need WhatsApp/SMS provider choice and credentials through environment configuration (never chat), template approval, deployed web/API domains, and owner bootstrap/2FA recovery ownership. Local infrastructure and fake-provider tests can proceed before these inputs; production authentication cannot be called ready without them.

Money/quote contradictions listed in dev1.md remain outside this foundation increment. Real zone polygons and operating values are supplied before live use; test fixtures must remain clearly separate. No schedule commitment until runtime/database/provider setup is verified.
