# API · F02 Roles & Permissions

Spec: [F02](../foundation/02-roles-and-permissions.md) · Conventions: [00](00-conventions.md)

Implementation status (2026-11-06): all 15 endpoints below are implemented. F02 routes register whenever `JWT_SECRET` is configured, independently of mock OTP. They require a valid persisted staff session; production password login, owner bootstrap and 2FA enrolment are delivered by the staff F01 slice. Development mock login remains explicitly guarded.

All endpoints are admin-only. Warehouse-scoped staff only see data for their warehouses; `GET /me/access` (F01) returns the caller's own scope.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/permissions` | Admin `roles:manage` | Every registered permission key, grouped |
| `GET` | `/admin/roles` | Admin `roles:manage` | List roles |
| `POST` | `/admin/roles` | Admin `roles:manage` | Create a role |
| `GET` | `/admin/roles/:id` | Admin `roles:manage` | One role |
| `PUT` | `/admin/roles/:id` | Admin `roles:manage` | Replace a role's permission keys |
| `DELETE` | `/admin/roles/:id` | Admin `roles:manage` | Delete a role (not system, not in use) |
| `GET` | `/admin/staff` | Admin `staff:manage` | List staff accounts |
| `POST` | `/admin/staff` | Admin `staff:manage` | Create a staff account |
| `GET` | `/admin/staff/:id` | Admin `staff:manage` | One staff account |
| `PUT` | `/admin/staff/:id` | Admin `staff:manage` | Change name, role or warehouse scope |
| `POST` | `/admin/staff/:id/deactivate` | Admin `staff:manage` | Deactivate and revoke sessions |
| `POST` | `/admin/staff/:id/reactivate` | Admin `staff:manage` | Reactivate |
| `POST` | `/admin/staff/:id/reset-password` | Admin `staff:manage` | Set a new temporary password |
| `POST` | `/admin/staff/:id/reset-2fa` | Admin `staff:manage` | Remove 2FA so the user can re-enrol |
| `POST` | `/admin/staff/:id/force-logout` | Admin `staff:manage` | Revoke all sessions |

## GET /admin/permissions
200:
```json
{
  "data": {
    "admin": ["audit:view", "cash:manage", "catalog:import", "orders:manage"],
    "customer": ["address:create", "cart:view", "order:place_cod"],
    "rider": ["rider_assignment:acknowledge", "rider_order:deliver"]
  },
  "meta": { "count": 120 }
}
```
Use `admin` keys to draw the role editor's checkboxes.

All three groups are registered from the owning feature contracts. `meta.count` is the sum of group sizes, including keys shared across groups. Registration does not imply that a feature's endpoints are implemented. Newly seeded customer/rider roles use their registered keys; additive seeding preserves existing role grants.

## GET /admin/roles · GET /admin/roles/:id
200:
```json
{
  "data": [
    { "id": "role_1", "name": "super_admin", "permissions": ["*"], "isSystem": true },
    { "id": "role_2", "name": "admin", "permissions": ["orders:view", "orders:manage"], "isSystem": false },
    { "id": "role_5", "name": "packer", "permissions": ["orders:view", "orders:manage"], "isSystem": false }
  ],
  "meta": { "count": 3 }
}
```

The detail endpoint returns one role under `data`, not the list array shown above. Role reads and mutations return `Cache-Control: no-store`.

## POST /admin/roles
Body:
```json
{ "name": "packer", "permissions": ["orders:view", "orders:manage", "stock:view"] }
```
`name` is `lower_snake_case`. `*` is never allowed. 201: the role.

Errors: `400 VALIDATION_ERROR` (unknown key) · `409 CONFLICT` (name exists).

## PUT /admin/roles/:id
Body: `{ "permissions": ["orders:view"] }` · 200: the role. Authorization reads the current role on every request, so the next request uses the updated grants.

Errors: `403 FORBIDDEN` (system roles cannot be edited) · `404 NOT_FOUND`.

## DELETE /admin/roles/:id
200: `{ "data": { "ok": true } }`. Errors: `403 FORBIDDEN` (system role) · `409 CONFLICT` (role still assigned to users).

## POST /admin/staff
Body:
```json
{
  "email": "manager@darjeelingstores.in",
  "password": "Temp-Passw0rd!",
  "name": "Dorjee Lama",
  "roleId": "role_5",
  "scope": { "all": false, "warehouseIds": ["wh_1"] }
}
```
`password` ≥ 10 characters. 201:
```json
{
  "data": {
    "id": "user_9", "name": "Dorjee Lama", "email": "manager@darjeelingstores.in",
    "role": "packer", "status": "active",
    "scope": { "all": false, "warehouseIds": ["wh_1"] }
  }
}
```
Errors: `409 CONFLICT` (email exists) · `400 VALIDATION_ERROR` (role must be a staff role, not `customer` or `rider`).

## GET /admin/staff · GET /admin/staff/:id
Query for the list: `?q=`, `?roleId=`, `?status=active|deactivated`, `?limit`, `?cursor`. Response items have the shape above plus `lastLoginAt` and `twoFactorEnabled`.

`q` is a literal, case-insensitive name/email search (maximum 120 characters). `limit` defaults to 50, maximum 100. Results sort by ascending ID; pass `meta.nextCursor` to fetch the next page. `meta.count` is the returned page size. Invalid filters/cursors, unknown query fields and repeated parameters return 400. All staff responses use `Cache-Control: no-store`; credentials and internal revision fields are never returned. `lastLoginAt` is null until a login flow records it.

## PUT /admin/staff/:id
Body (all optional): `{ "name": "…", "roleId": "role_5", "scope": { "all": false, "warehouseIds": ["wh_1", "wh_2"] } }` · 200: the staff account. Changing role or scope takes effect on the next request.

## POST /admin/staff/:id/deactivate · reactivate · force-logout · reset-2fa
No body. 200: `{ "data": { "ok": true } }`. Deactivate and force-logout revoke every refresh token of that user. Each call is written to the audit log.

Revocation invalidates both access and refresh credentials across every session. Reactivation does not restore revoked sessions. Reset-2FA replaces the complete `twoFactor` credential object with `{ "enabled": false, "requiresEnrollment": true }`, removing the encrypted secret and recovery hashes, and revokes all sessions. It does not issue a login or enrolment token. Staff F01 enforces the pending enrolment state before granting a normal session.

## POST /admin/staff/:id/reset-password
Body: `{ "newPassword": "Temp-Passw0rd!" }` · 200: `{ "data": { "ok": true } }`. All sessions are revoked.

Create/reset passwords require at least 10 characters and at most 1024 UTF-8 bytes. Passwords use asynchronous scrypt with a random 16-byte salt and a versioned parameter format (`N=131072`, `r=8`, `p=1`). Both operations set `mustChangePassword: true`; Staff F01 enforces the password-change transition. Plaintext passwords and password hashes are excluded from responses and audit records.

## Implemented staff safeguards

Every staff route requires an active staff session and `staff:manage`. Warehouse-scoped managers can read or change only accounts whose complete, nonempty warehouse scope is a subset of their own; all-warehouse accounts are hidden from them. Out-of-scope targets return 404. New scope cannot exceed the actor's scope. Warehouse IDs must be unique existing records in `warehouses`; missing geography data causes the grant to fail, rather than accepting arbitrary IDs.

Only ordinary staff roles can be assigned. `super_admin`, `customer` and `rider` are not assignable through these routes; owner records are protected from staff mutations (403). Actor permissions must cover both the target's existing role and the newly assigned role. A caller cannot deactivate themselves or update their own role/scope. Accounts outside active/deactivated states cannot be administered (409). Unknown body fields, empty updates and bodies on no-body actions are rejected with 400.

Mutations revalidate and lock the actor's persisted session, active user and current role inside the transaction. Assigned roles share the revision protocol used by role deletion. Each successful change, allowlisted before/after audit snapshot and required user-wide revocation commit atomically; audit failure rolls everything back. Role/scope edits apply on the next request without waiting for token expiry.

## Implemented role mutation safeguards

Role names are immutable lowercase snake case (up to 64 characters); launch-role names are reserved. Unknown/duplicate permission keys, wildcard grants and extra body fields return 400. Role administration requires `roles:manage` and all-warehouse scope. An actor can grant only registered keys they already possess and cannot modify a target role with permissions exceeding their own. `super_admin`, `customer` and `rider` are protected. The legacy `admin` seed remains non-system.

Create/update/delete commit with an audit event and allowlisted before/after role snapshots in the same transaction. Audit persistence failure rolls the role change back. Deletion returns 409 when any user references the role, including inactive users. Current user creation and role deletion touch the same role revision inside their transactions to prevent dangling references. Future role-assignment paths must follow this protocol too.

Cookie-authenticated role and staff mutations require a configured trusted Origin and `X-CSRF-Token: 1`; bearer-only clients are authenticated independently. Disabling mock OTP removes development login routes, while F02 remains registered when `JWT_SECRET` is configured. Production login and 2FA enrolment are provided by the [staff F01 flow](../engineering/staff-authentication.md).
