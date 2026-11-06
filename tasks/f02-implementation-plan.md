# F02 implementation plan: roles, staff and authorization

Status: ready for implementation review, 2026-11-06. Baseline: `1d2d920` (latest `origin/main` fetched and fast-forwarded into `feat/authentication`). Two local grant-policy edits in `access.public.ts` and `access.test.ts` were retained. This is a plan, not implementation evidence. Parent tracker: [foundation checklist](todo.md); parent design: [foundation plan](plan.md).

## 1. Outcome and scope

Complete all 15 endpoints in [F02](../docs/api/F02-roles-and-permissions.md), connect Roles and Staff admin screens, and prove authorization works across the newly pulled catalog/offerings modules. Add `/me/access` as the F01 support endpoint. Keep administration behind the development-session guard until production login and owner enrollment are separately implemented and verified.

Production password login/2FA enrollment, geography CRUD, notifications and order features are outside this increment. Password hashing/storage for staff creation and reset, audited reset transitions, current-session revocation and safe warehouse-grant validation are included because F02 requires them. Existing warehouses may be validated through an injected directory; when no authoritative directory exists, reject nonempty warehouse grants rather than silently accepting arbitrary IDs.

## 2. Verified source baseline

| Area | Present | Missing |
|---|---|---|
| Roles | Mongoose schema, unique name index, additive seed, role list and admin permission list | Detail/mutations, protected-role mutation policy, assigned-role deletion guard |
| Authorization | `canAccess`, `requirePermission`, current role/scope lookup in development sessions | Shared current-actor resolver, general scope filtering, mutation-time consistency |
| Grant policy | Local `canGrantPermissions` helper and tests | Integration with real audited mutations; target-role authority checks |
| Identity | Canonical user identifiers, account kind, optional unique identifiers | Staff service, password credential fields, role-reference integrity and safe assignment |
| Sessions | Durable `auth_sessions`, signed access JWT, hashed rotating refresh, cookie/CSRF helpers | Transactional user-wide forced logout and credential-reset integration |
| Audit | Strict metadata writer requiring an active transaction | Before/after policy for roles/staff, scoped administrative reads later |
| Admin UI | Development login, cookie client, read-only Roles page | Role editing and Staff screens |
| Catalog/offerings | Modules, guarded routes, own actor contract and transaction adapters | Real identity resolver wiring: `composition/dev2.ts` currently defaults to `denyAll` |

Current registry contains administrative keys only. Customer/rider launch roles have empty permission arrays; do not advertise a complete global registry until F01/F19-owned keys are registered and tested. Existing `admin` seed is non-system while the F02 example calls it system: reconcile explicitly below.

## 3. Contract and safety decisions

1. Preserve `/api/v1`, server-generated UUID request IDs, error envelope and safe role projections. Role list returns an array plus count; detail returns a single object. Validate ObjectId paths before querying.
2. Custom role names are canonical lower_snake_case, max 64 characters. Reject reserved names (`super_admin`, `admin`, `customer`, `rider`), unknown/duplicate permission keys, wildcard grants and extra input fields. Update changes permissions only, not name or system status.
3. Protect `super_admin`, `customer`, `rider` as system roles. Keep the existing non-system `admin` seed for compatibility, but reserve its name and prevent weaker actors from modifying a role with stronger permissions. If the owner elects to protect `admin` too, migrate explicitly; do not silently flip existing records during seed.
4. Role/staff administration requires staff identity, the exact permission and all-warehouse scope initially. Warehouse-scoped role management is deferred because roles are global. Listing staff scoped to warehouses can be introduced only with a defined subset rule; until then require all-scope and return 403 for narrower actors.
5. Grant no permission the actor does not possess. Wildcard is valid only on the protected super-admin role and never client-assignable. A role manager cannot edit/delete a target role whose current grants exceed their own, even when the replacement removes those grants. Permissions are exact keys: `orders:manage` does not implicitly include `orders:view`.
6. Staff operations can assign only staff roles; customer/rider roles and super-admin assignment are forbidden through these APIs. Owner creation remains a separate bootstrap operation. Protect owner records against role/scope/credential/status changes through ordinary staff routes; protect actor self-deactivation and self-role/scope narrowing that removes administrative recovery. Document precise errors.
7. Every successful role/staff mutation and its audit record commit in one replica-set transaction. Failed/denied attempts do not commit business writes. Audit only approved fields: role name/permission changes, user ID, status, role ID and scope; exclude passwords, hashes, OTP/TOTP secrets, cookies and token values. Include actor, target, action, request ID and bounded reason where required.
8. Use durable transaction conflict points for read-then-write invariants. Role deletion and every assignment path must touch the same role lifecycle revision. Owner-sensitive changes touch a shared owner-policy revision. Do not rely on a users-count lookup alone or a process-local mutex.
9. Re-read and validate the current actor's user, role, session and target state inside the mutation transaction. Coordinate with authorization revision updates so concurrent grant withdrawal/deactivation causes a conflict/retry, then denial. Never trust a body actorId/role/scope or stale login payload.
10. Current request authorization reads current user and role. Permission updates affect the next request; session revocation is durable and checked on access and refresh. Explicitly test refresh rotation against concurrent force logout. No permission cache is required at this scale.
11. Cookie mutations require trusted Origin and the existing CSRF header; keep bearer transport explicit and do not let a bearer header bypass cookie-mode CSRF checks when cookies are present. Validate same-origin deployment/proxy behavior using existing helpers.
12. Use Node's scrypt with a random salt and a versioned parameter format for new staff passwords; cap password byte length, require the documented minimum, never log input. Verify the selected API in local Node type/runtime documentation. Staff records created here cannot use production password sign-in until F01 is delivered; the UI must explain that accurately.
13. Reset-2FA requires authorization, session invalidation and restricted re-enrollment; it must never mint a normal session. If no implemented 2FA credential lifecycle exists, keep reset-2FA unavailable with a documented safe error until the credential service is ready. Do not return success for a no-op masquerading as recovery.
14. Administrative responses use `Cache-Control: no-store`. Paginated staff reads validate limits/cursors and escape literal search. Project only approved fields; no credential/session payload is returned.

## 4. Data, module and integration design

Follow the module layering already used by catalog/offerings: pure policy under `domain`, use cases and required ports under `application`, Mongo transaction adapters under `infrastructure`, validation/mapping/routes under `interface`. Keep public exports small. Do not create generic base services/repositories.

Access owns role reads/writes and permission policy. Identity owns all user and credential writes, plus session revocation. The composition root connects their public operations; neither module imports the other's private schema. Audit persistence is injected through its public contract with the transaction context. Do not copy catalog's error class into another framework; pick one compatible transport error mapping and document its ownership.

Proposed additions, introduced only when needed:

- Role lifecycle/version field and safe projection; preserve existing IDs and seed behavior.
- User authorization/credential version, role-assignment revision and encrypted/hashed credential fields only as consumed by delivered behavior.
- Public identity operations for current actor lookup, scoped staff queries, assignment/deactivation and transactional user-wide session revoke.
- Public role operations that validate and participate in assignment/delete consistency using the same transaction.
- One actor mapping from identity into access and the catalog/offerings `AuthResolver` at composition. Translate `null`/`undefined`, `userId`, role label and scope deliberately. Retain account-kind checks so a customer with malformed grants cannot become a catalog administrator.
- No new workspace package or dependency unless a real requirement cannot use installed tools/platform APIs.

Indexes: retain unique role name and canonical user email/phone indexes. Add staff query indexes based on `kind/status/_id` and optional role filters. Use a userId/session index for force logout. Initialize indexes through repeatable setup; test existing-data conflicts instead of deleting records to force them through.

## 5. Endpoint delivery matrix

| Endpoint | Slice | Required behavior |
|---|---|---|
| GET `/admin/permissions` | F02-01/02 | Registered groups/count accurate; all-scope authorization |
| GET `/admin/roles` | F02-02 | Safe list, stable ordering, no-store |
| GET `/admin/roles/:id` | F02-02 | Safe single object; invalid/absent ID handled |
| POST `/admin/roles` | F02-05 | Strict name/grants; duplicate conflict; audit |
| PUT `/admin/roles/:id` | F02-06 | Protected role denial; target/grant policy; immediate effect |
| DELETE `/admin/roles/:id` | F02-07 | Protected/in-use denial; race-safe deletion; audit |
| GET `/admin/staff` | F02-10 | Safe pagination/filter/projection; required authority |
| GET `/admin/staff/:id` | F02-10 | Safe detail and resource checks |
| POST `/admin/staff` | F02-11 | Hashed password, staff role/scope validation, audited transaction |
| PUT `/admin/staff/:id` | F02-12 | Strict editable fields; safe role/scope assignment; immediate effect |
| POST deactivate/reactivate | F02-13 | Owner/self protection; audited transition and session policy |
| POST force-logout | F02-14 | Revoke all target sessions transactionally, idempotent outcome |
| POST reset-password | F02-15 | Hash replacement, user-wide revocation and audit |
| POST reset-2fa | F02-16 | Real restricted re-enrollment transition; no success stub |
| GET `/me/access` (F01 support) | F02-03 | Current safe permissions/scope for signed-in actor |

## 6. Ordered implementation slices

Every slice includes implementation, negative cases and documentation updates. IDs refine existing B07/B10/B11/B12 tasks; they do not replace their progress history.

### Phase A — consistent authorization and contracts

**F02-01 — Reconcile registry and protected-role policy (S).** Depends: none. Files: F02 feature/API docs, access registry/policies/tests. Done: canonical keys, system/reserved role set, grant/target policy and staff/owner restrictions are explicit; examples match current seeded data. Verify unknown/wildcard keys, subset grants, stronger-target rejection and seed drift. Record customer/rider registry gaps rather than inventing empty capabilities as completed.

**F02-02 — Finish role read endpoints (S).** Depends: 01. Files: access read adapter/routes, development composition, HTTP integration tests. Done: list/detail/permissions enforce the same authority and safe projection; no-store and malformed ID handling. Verify unauthenticated, customer, missing grant, warehouse-scoped, revoked and valid owner cases; unimplemented mutation paths remain unavailable.

**F02-03 — Extract current-actor resolution and wire consumers (M).** Depends: 01. Files: identity public actor service, composition/container, access and catalog/offerings integration tests. Done: existing development sessions resolve one authoritative actor; `/me/access` exists; catalog routes accept only authorized staff and enforce scope with current data. Verify same token before/after role edit, scope change, deactivation/logout; no client role/header impersonation; default production without authentication stays deny-by-default.

Checkpoint A: role reads work through the admin UI; both access and newly pulled catalog modules enforce current server authority. Production authentication remains pending.

### Phase B — transactional role mutation

**F02-04 — Add transaction and audit consistency operations (M).** Depends: 01/03. Files: access transaction port/adapter, identity assignment public operation, audit schema/projection, real DB tests. Done: assignment/delete share a conflict record; actor validity and role authority are rechecked in transactions; approved before/after audit fields are persisted without secrets. Verify injected audit persistence failure rolls back the business write. Avoid silently exposing Mongoose internals to domain code.

**F02-05 — Create roles (M).** Depends: 04. Files: role create use case/schema/route and HTTP+DB tests. Done: canonical name, registered unique keys only, no wildcard/reserved/system injection, actor subset grants, 201 safe response. Verify duplicate simultaneous creates yield one role/one committed audit and a mapped 409; denied/invalid writes produce neither record.

**F02-06 — Update role permissions (M).** Depends: 05. Files: role update policy/action/route/tests. Done: system roles immutable; actor may control target's current grants and proposed grants; versioned/conditional updates prevent stale overwrite; new grants apply on next protected request. Verify lost-update conflict, concurrent authority withdrawal, attempted self-escalation and audit rollback.

**F02-07 — Delete roles safely (M).** Depends: 04/06. Files: role delete action, identity usage/assignment protocol, HTTP+DB tests. Done: system/in-use roles denied, target authority checked, absent role maps 404, successful delete audited. Verify assignment/delete race repeatedly with barriers: no surviving user references a deleted role; failed audit preserves role. In-use includes inactive users until an explicit reassignment policy says otherwise.

**F02-08 — Connect role editor UI (M).** Depends: 05–07 API checks passing. Files: current Roles component, role form/error styles, browser verification. Done: create, permission selection, edit, delete confirmation and refetch; system controls unavailable; no optimistic grant changes; conflict/forbidden/expired-session states clear; pending submission blocked. Verify keyboard access and narrow/desktop layout plus actual API network responses. A timeout does not trigger an automatic retry of create; refresh the list to resolve ambiguity.

Checkpoint B: create → update → protected request reflects changes → delete works; all prohibited mutations fail; audit persistence failure leaves business state unchanged. Role editing ships only after this gate.

### Phase C — staff persistence and reads

**F02-09 — Establish staff data and credential service (M).** Depends: 04. Files: identity schema/actions/password adapter, session public API, tests. Done: canonical email, explicit immutable kind, validated staff-role reference, deny unknown fields, bounded password hashing and partial uniqueness. Verify missing/null identifiers, duplicate canonical emails, hash verification and no plaintext in DB/logs/responses. Existing users remain readable without destructive migration.

**F02-10 — Staff list/detail (M).** Depends: 09/03. Files: identity read contract/adapter, access staff HTTP routes, integration tests. Done: permission and all-scope checks, safe fields, bounded filters/pagination and no credentials. Verify deterministic cursor order, invalid cursors, literal search injection, nonexistent ID, forbidden customers and narrower staff.

**F02-11 — Create staff (M).** Depends: 09/10 and authoritative warehouse validation. Files: identity create action, access orchestration, warehouse read port, HTTP tests. Done: cannot assign owner/customer/rider role, grant above actor, unknown warehouse or contradictory scope; password stored hashed; creation and audit atomic. Verify concurrent email duplicate, deleted-role race, failed audit and unsupported warehouse directory all fail safely. No default password.

**F02-12 — Update staff role/scope (M).** Depends: 11. Files: identity update action, access target policy, HTTP tests. Done: only name/role/scope accepted; protects owner/self policy; assignments use shared conflict protocol; scope/role effects visible immediately. Verify foreign/invalid grants, customer conversion, forbidden field injection, concurrent role deletion and old-authority requests.

Checkpoint C: authorized staff reads and audited create/update work against real persistence. A role label rename cannot change account kind or grant owner status.

### Phase D — staff lifecycle and session revocation

**F02-13 — Deactivate/reactivate (M).** Depends: 12. Files: identity lifecycle/owner-policy operations, session revocation, routes/tests. Done: protected-owner and self-lockout policy enforced; deactivate revokes all sessions in the same transaction; reactivate never revives revoked credentials. Verify last-owner/concurrent owner changes, inactive target, idempotence and audit failure.

**F02-14 — Force logout (S/M).** Depends: 13. Files: session user-wide revoke action, route/tests. Done: every active family/access credential becomes unusable; response contains no token; audited result; target policy enforced. Verify multiple devices, refresh-vs-revoke race and no partial revoke on failed audit.

**F02-15 — Reset staff password (M).** Depends: 09/14. Files: identity credential reset, route/tests. Done: authorized password change, hashed replacement, credential/authorization version update and all-session invalidation commit with audit. Verify old password/access/refresh rejection, new hash verification, oversized input and rollback. Production login acceptance remains a separate F01 gate.

**F02-16 — Reset 2FA with restricted recovery (M).** Depends: real F01 enrollment/recovery service and 14. Files: identity credential state, reset route, restricted enrollment tests. Done: clear/rotate encrypted secret under explicit policy, invalidate sessions and require fresh restricted setup; no normal session issued. Verify unauthorized/replayed setup and owner bypass attempts. If the F01 prerequisite is absent, this slice remains blocked and the endpoint/UI stays unavailable; do not stub it as successful.

**F02-17 — Connect Staff UI (M, split reads/actions if needed).** Depends: 10 for reads; 11–16 individually for actions. Files: admin navigation, Staff component/forms, existing session client. Done: enable only delivered actions, field-level errors, safe confirmations for deactivation/reset, pending states and refreshed authoritative data. Display actual records only. Verify creates/edits/forced logout through real API, keyboard use, responsive layout, and denial after authority changes. 2FA reset remains absent until 16 passes.

Checkpoint D: staff lifecycle and multi-device revoke work; owner cannot be removed through ordinary staff APIs; no password or enrollment secret appears in audit or UI error logs.

### Phase E — acceptance and handoff

**F02-18 — Full F02 acceptance and docs (M).** Depends: delivered slices above. Files: F02 docs, implemented API reference, tasks checklist and targeted tests. Done: all 15 endpoints traced to actual tests; list/detail examples are accurate; endpoint availability/dev-only guard documented; UI matches supported actions. Run the commands below, record results/skips, inspect runtime responses and review final diff for secret leakage/suppressed checks. Parent B12 is not complete until all required credential-reset semantics work.

## 7. Test matrix and commands

Run tests against the disposable replica-set harness only. New `harness.reset()` uses dropDatabase; never pass it an arbitrary environment connection. Fix the harness contract to retain local-server ownership before extending cleanup utilities.

| Risk | Required evidence |
|---|---|
| Permission escalation | Missing grant, wildcard/custom role, stronger-target mutation, wider scope, forged body actor |
| Immediate enforcement | Same session before/after role grants, scope changes, logout and deactivation |
| Role integrity | System role denial, assigned inactive user, concurrent assignment/delete, reserved names and seed reruns |
| Owner safety | Owner target protections, self-disable, concurrent last-owner transition |
| Audit consistency | Actual forced insert failure, full rollback, allowed before/after fields, no credential contents |
| Credentials | Password length/byte bounds, salted hash format, no plaintext transport/log/audit leaks |
| Sessions | Multi-device revoke, refresh race, cookie CSRF/origin rejection, stale JWT denial |
| API shape | 400/401/403/404/409 errors, request ID, no-store, safe list/detail DTOs |
| UI | Loading/empty/denied/error, create ambiguity, conflict recovery, keyboard/mobile layout |
| Catalog integration | Fresh identity resolver grants expected warehouse reads/writes and denies others |

Commands from repo root, sequentially; stop on failure:

```powershell
pnpm --filter @darjeeling/shared build
pnpm typecheck
pnpm test
pnpm check:boundaries
pnpm --filter @darjeeling/api test:integration
pnpm build
```

Focused tests use existing Vitest scripts. Record real counts, not historical numbers. Windows POSIX signal skip and Docker runtime availability are separate evidence limits, not passed F02 checks. Browser tests require a working browser connector; typechecking alone does not prove UI behavior.

## 8. Rollout and open gates

Keep mutations registered only through guarded development composition. Existing non-system seed records are not overwritten. Any credential/index migration must be additive, with detection and explicit resolution of conflicting existing data. Do not update the supplied Atlas database while implementing this plan.

Before production enablement require F01 staff password/2FA and secure owner bootstrap, actual-domain cookie tests, authenticated DB/IAM setup and a restore exercise. This F02 plan does not silently promote mock OTP to production identity.

Inputs remaining: exact owner recovery custodian/proof, authoritative warehouse directory, customer/rider registry ownership and whether the owner elects to protect legacy `admin` as a system role. Use the safe policies above while these remain unresolved; record any contract change in the owning feature/API docs.

No builds, tests or database operations were run for this planning turn. Remote code was fetched and fast-forwarded; all implementation entries above remain pending except the explicitly described existing baseline.
