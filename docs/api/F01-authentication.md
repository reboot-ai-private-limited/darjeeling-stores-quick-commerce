# API · F01 Authentication

Spec: [F01](../foundation/01-authentication.md) · Conventions: [00](00-conventions.md)

Implementation status (2026-11-06): all 16 endpoint handlers below are implemented, including customer/rider authentication, own-account mutations, device registration and public app configuration. Staff email/password sign-in and the explicit owner-bootstrap CLI remain in place; there is no two-factor step. Live WhatsApp/SMS delivery is deferred: development accepts `000000` only with `mockOTP=true`, `NODE_ENV=development` and a database ending in `_dev` or `_test`; without a configured delivery transport, nonmock OTP request/verify returns `503 OTP_DELIVERY_UNAVAILABLE`. See [staff authentication](../engineering/staff-authentication.md) and [development authentication](../engineering/development-auth.md).

Transport: native login sends `X-Client: customer-app` or `rider-app`, without Origin/cookies, to receive access and refresh credentials in JSON. Native refresh/logout accepts a 64-character hexadecimal refresh token in JSON. Browser clients send `X-Client: web` or `admin`, use HTTP-only cookies, and receive no credentials in JSON. Any Origin/cookie mutation requires an exact trusted Origin and `X-CSRF-Token: 1`; a native header cannot bypass this. Browser refresh/logout uses cookies, without a JSON refresh token.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/request-otp` | Public | Send a login OTP by WhatsApp (SMS fallback) |
| `POST` | `/auth/verify-otp` | Public | Verify the OTP and log in (creates a customer on first login) |
| `POST` | `/auth/refresh` | Public | Swap a refresh token for a new session |
| `POST` | `/auth/logout` | Auth | Revoke the refresh token |
| `POST` | `/admin/auth/login` | Public | Staff login with email and password |
| `GET` | `/me` | Auth | Current user's profile |
| `PUT` | `/me` | Auth | Update name or email |
| `POST` | `/me/phone/request-otp` | Customer | Send an OTP to a new phone number |
| `POST` | `/me/phone/verify` | Customer | Confirm the new phone number |
| `GET` | `/me/access` | Auth | Role, permission keys and warehouse scope |
| `POST` | `/me/delete-request` | Customer | Ask for account deletion |
| `POST` | `/devices` | Auth | Register or refresh the FCM push token |
| `DELETE` | `/devices/:fcmToken` | Auth | Remove a push token (on logout) |
| `GET` | `/app/config` | Public | Force-update, maintenance and support info |

## POST /auth/request-otp
Auth: Public · Rate limit: five requests per hour per phone and per IP, persisted in MongoDB. An active code cannot be replaced before its five-minute expiry. Five incorrect attempts lock verification and resend for 15 minutes. Codes are hashed and consumed once transactionally. The local seeded mock owner is exempt from request quotas.

Body:
```json
{ "phone": "+919876543210", "channel": "whatsapp", "app": "customer" }
```
`channel`: `whatsapp` (default) or `sms`. `app`: `customer` (auto-creates the account on verify) or `rider` (phone must be pre-registered).

200:
```json
{ "data": { "expiresInSeconds": 300, "channel": "whatsapp" } }
```
`channel` is the channel actually used (it can become `sms` after a fallback). The OTP itself is never returned. Guarded mock mode returns `channel: "mock"` and `mockOTP: true`; use the fixed development code `000000`.

Errors: `400 VALIDATION_ERROR` · `403 OTP_REQUEST_REJECTED` (unknown rider, blocked or wrong-role number; deliberately generic) · `429 RATE_LIMITED` · `502 OTP_DELIVERY_FAILED`.

## POST /auth/verify-otp
Body:
```json
{ "phone": "+919876543210", "otp": "482913", "deviceInfo": "Pixel 7 · Android 14 · app 1.4.2" }
```
200:
```json
{
  "data": {
    "accessToken": "eyJhbGciOi…",
    "accessTokenExpiresInSeconds": 900,
    "refreshToken": "rt_Zk3pQ9…",
    "user": { "id": "user_1", "name": "", "phone": "+919876543210", "role": "customer", "status": "active" },
    "isNewUser": true
  }
}
```
`isNewUser: true` means ask for the name and first address next.

Errors: `401 INVALID_OTP` (`details.attemptsLeft`) · `400 OTP_EXPIRED` · `429 OTP_LOCKED` · `403 FORBIDDEN` (account blocked or deactivated).

## POST /auth/refresh
Body: `{ "refreshToken": "rt_Zk3pQ9…" }`

200: a new Session (same shape as above, without `isNewUser`). The old refresh token is now invalid; store the new one.

Errors: `401 UNAUTHORIZED` (expired or revoked) · `401 REFRESH_REUSED` (a used token was replayed; every session of the user is revoked, so log in again).

## POST /auth/logout
Body: `{ "refreshToken": "rt_Zk3pQ9…" }` · 200: `{ "data": { "ok": true } }` (idempotent).

## POST /admin/auth/login
Body:
```json
{ "email": "owner@darjeelingstores.in", "password": "••••••••••" }
```

200: a Session whose `user.role` is `admin` or `super_admin`.

Implemented staff roles also include custom staff roles. Browser sessions use HTTP-only cookies and omit tokens from JSON when `X-Client: admin`. Accounts with a temporary password receive only `{ "data": { "nextAction": "change_password", "expiresInSeconds": 600 } }` and an expiring restricted cookie; they have no normal session yet. Complete `POST /admin/auth/change-password` with `{ "newPassword": "…" }` to receive the session. `GET /admin/auth/status` restores the pending step; `POST /admin/auth/cancel` invalidates it. The password-change endpoint rejects reusing the temporary password.

Errors: `401 INVALID_CREDENTIALS` · `429 ACCOUNT_LOCKED` (`details.retryAfterSeconds`) · `429 RATE_LIMITED`.

## GET /me
200:
```json
{
  "data": {
    "id": "user_1", "name": "Asha Rai", "phone": "+919876543210", "email": null,
    "role": "customer", "status": "active",
    "defaultAddressId": "addr_1", "codAllowed": true,
    "notificationPrefs": { "promoPush": false, "promoWhatsApp": false, "cartReminders": false }
  }
}
```

## PUT /me
Body: `{ "name": "Asha Rai", "email": "asha@example.com" }` (both optional, at least one). 200: the updated profile (same shape as `GET /me`). Phone cannot be changed here. Unknown fields are rejected; email is normalized and unique. Email changes invalidate pending staff challenges and revoke other sessions. New profiles default promotional notification preferences to false.

## POST /me/phone/request-otp · POST /me/phone/verify
Request body `{ "phone": "+919800000000" }` → 200 `{ "data": { "expiresInSeconds": 300 } }`. Verify body `{ "phone": "+919800000000", "otp": "482913" }` → 200 the updated profile. Errors: `409 CONFLICT` (number already used) · OTP errors as above. Codes are bound to the customer, purpose, source phone and credential revision. Success revokes other sessions and retains the current one.

## GET /me/access
200:
```json
{
  "data": {
    "role": "admin",
    "permissions": ["orders:view", "orders:manage", "dispatch:manage", "auth:logout"],
    "scope": { "all": false, "warehouseIds": ["wh_1"] }
  }
}
```
Use it to hide UI the user cannot use. The server still enforces every check.

## POST /me/delete-request
Body: `{ "reason": "Moving away" }` (optional). 200: `{ "data": { "status": "deletion_requested" } }`. The request immediately revokes all sessions, removes device tokens and invalidates pending OTPs. An admin finalises deletion later (F25).

## POST /devices · DELETE /devices/:fcmToken
Body: `{ "fcmToken": "fcm_abc…", "platform": "android", "app": "rider", "appVersion": "1.4.2" }` → 200 `{ "data": { "ok": true } }`. `app`: `customer` or `rider`. Call after every login and when FCM rotates the token. Call `DELETE` on logout. Account kind must match the app; rider devices support Android only. A token owned by another account returns 409; removal only affects caller-owned tokens. Versions must use numeric `major.minor.patch`.

## GET /app/config
Query: `app=customer|rider&platform=android|ios&version=1.4.2`

200:
```json
{
  "data": {
    "minSupportedVersion": "1.3.0",
    "latestVersion": "1.5.0",
    "forceUpdate": false,
    "downloadUrl": "https://example.com/get-app",
    "maintenance": { "active": false, "message": null },
    "supportNumber": "+919800000001"
  }
}
```
Call on every app launch. If `forceUpdate` is true or `maintenance.active` is true, block the app with the matching screen. `503 SERVICE_UNAVAILABLE` is returned by business endpoints during maintenance; health, readiness and app config stay available.

The validated `PUBLIC_APP_CONFIG_JSON` environment value supplies `customer.android`, `customer.ios`, `rider.android` release objects (`minSupportedVersion`, `latestVersion`, `downloadUrl`), plus `maintenance` and `supportNumber`. Defaults are versions `0.0.0`, null download/support values and maintenance off. Unknown fields, invalid versions and minimum versions above latest are rejected at startup. URLs must use HTTPS. Restart after changes; dynamic scoped settings administration remains D1-3.
