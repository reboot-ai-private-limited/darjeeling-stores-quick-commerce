# API · F02 Roles & Permissions

Spec: [F02](../foundation/02-roles-and-permissions.md) · Conventions: [00](00-conventions.md)

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

## GET /admin/roles · GET /admin/roles/:id
200:
```json
{
  "data": [
    { "id": "role_1", "name": "super_admin", "permissions": ["*"], "isSystem": true },
    { "id": "role_2", "name": "admin", "permissions": ["orders:view", "orders:manage"], "isSystem": true },
    { "id": "role_5", "name": "packer", "permissions": ["orders:view", "orders:manage"], "isSystem": false }
  ],
  "meta": { "count": 3 }
}
```

## POST /admin/roles
Body:
```json
{ "name": "packer", "permissions": ["orders:view", "orders:manage", "stock:view"] }
```
`name` is `lower_snake_case`. `*` is never allowed. 201: the role.

Errors: `400 VALIDATION_ERROR` (unknown key) · `409 CONFLICT` (name exists).

## PUT /admin/roles/:id
Body: `{ "permissions": ["orders:view"] }` · 200: the role. The permission cache refreshes immediately.

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

## PUT /admin/staff/:id
Body (all optional): `{ "name": "…", "roleId": "role_5", "scope": { "all": false, "warehouseIds": ["wh_1", "wh_2"] } }` · 200: the staff account. Changing role or scope takes effect on the next request.

## POST /admin/staff/:id/deactivate · reactivate · force-logout · reset-2fa
No body. 200: `{ "data": { "ok": true } }`. Deactivate and force-logout revoke every refresh token of that user. Each call is written to the audit log.

## POST /admin/staff/:id/reset-password
Body: `{ "newPassword": "Temp-Passw0rd!" }` · 200: `{ "data": { "ok": true } }`. All sessions are revoked.
