# Backend foundation checklist

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
