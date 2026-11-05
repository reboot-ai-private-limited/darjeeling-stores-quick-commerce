# API · F01 Authentication

Spec: [F01](../foundation/01-authentication.md) · Conventions: [00](00-conventions.md)

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/request-otp` | Public | Send a login OTP by WhatsApp (SMS fallback) |
| `POST` | `/auth/verify-otp` | Public | Verify the OTP and log in (creates a customer on first login) |
| `POST` | `/auth/refresh` | Public | Swap a refresh token for a new session |
| `POST` | `/auth/logout` | Auth | Revoke the refresh token |
| `POST` | `/admin/auth/login` | Public | Staff login with email, password and optional 2FA code |
| `POST` | `/admin/auth/2fa/setup` | Admin (any) | Start 2FA enrolment |
| `POST` | `/admin/auth/2fa/enable` | Admin (any) | Confirm 2FA with a first code |
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
Auth: Public · Rate limit: `otpMaxPerHour` per phone and per IP.

Body:
```json
{ "phone": "+919876543210", "channel": "whatsapp", "app": "customer" }
```
`channel`: `whatsapp` (default) or `sms`. `app`: `customer` (auto-creates the account on verify) or `rider` (phone must be pre-registered).

200:
```json
{ "data": { "expiresInSeconds": 300, "channel": "whatsapp" } }
```
`channel` is the channel actually used (it can become `sms` after a fallback). The OTP itself is never returned.

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
{ "email": "owner@darjeelingstores.in", "password": "••••••••••", "totpCode": "123456" }
```
`totpCode` is only needed when the account has 2FA on.

200: a Session whose `user.role` is `admin` or `super_admin`.

Errors: `401 INVALID_CREDENTIALS` · `401 TOTP_REQUIRED` (resend with `totpCode`) · `429 ACCOUNT_LOCKED` (`details.retryAfterSeconds`) · `429 RATE_LIMITED`.

## POST /admin/auth/2fa/setup · POST /admin/auth/2fa/enable
Setup 200:
```json
{ "data": { "secret": "JBSWY3DPEHPK3PXP", "otpauthUrl": "otpauth://totp/DarjeelingStores:owner@darjeelingstores.in?secret=JBSWY3DPEHPK3PXP&issuer=DarjeelingStores" } }
```
Enable body: `{ "code": "123456" }` · 200: `{ "data": { "ok": true } }` · Errors: `401 INVALID_OTP`.

## GET /me
200:
```json
{
  "data": {
    "id": "user_1", "name": "Asha Rai", "phone": "+919876543210", "email": null,
    "role": "customer", "status": "active",
    "defaultAddressId": "addr_1", "codAllowed": true,
    "notificationPrefs": { "promoPush": true, "promoWhatsApp": false, "cartReminders": false }
  }
}
```

## PUT /me
Body: `{ "name": "Asha Rai", "email": "asha@example.com" }` (both optional, at least one). 200: the updated profile (same shape as `GET /me`). Phone cannot be changed here.

## POST /me/phone/request-otp · POST /me/phone/verify
Request body `{ "phone": "+919800000000" }` → 200 `{ "data": { "expiresInSeconds": 300 } }`. Verify body `{ "phone": "+919800000000", "otp": "482913" }` → 200 the updated profile. Errors: `409 CONFLICT` (number already used) · OTP errors as above.

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
Body: `{ "reason": "Moving away" }` (optional). 200: `{ "data": { "status": "deletion_requested" } }`. An admin finalises it later (F25).

## POST /devices · DELETE /devices/:fcmToken
Body: `{ "fcmToken": "fcm_abc…", "platform": "android", "app": "rider", "appVersion": "1.4.2" }` → 200 `{ "data": { "ok": true } }`. `app`: `customer` or `rider`. Call after every login and when FCM rotates the token. Call `DELETE` on logout.

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
Call on every app launch. If `forceUpdate` is true or `maintenance.active` is true, block the app with the matching screen. `503 SERVICE_UNAVAILABLE` is returned by all other endpoints during maintenance.
