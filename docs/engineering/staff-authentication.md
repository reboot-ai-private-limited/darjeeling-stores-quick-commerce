# Staff authentication and owner setup

Staff email/password sign-in, TOTP enrolment, temporary-password changes, cookie refresh/logout and F02 administration are implemented. Customer/rider OTP delivery remains separate work. The admin web workspace exposes Staff, Roles & permissions and Security according to the current session's permissions.

## Configure

Use a MongoDB replica set. Configure `MONGODB_URI`, independent random 32-byte hex `JWT_SECRET` and `STAFF_TOTP_KEY`, and exact browser origins in `CORS_ORIGINS`. Generate each key separately with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep keys in the private `.env` or deployment secret store. Never commit them. Preserve the TOTP encryption key securely: losing it makes enrolled authenticators unusable. Production uses `NODE_ENV=production`, `mockOTP=false`, `AUTH_COOKIE_SECURE=true` and HTTPS. Configure trusted proxy hops to match the deployment; client-IP limits depend on that boundary. Changing encryption/signing keys requires a deliberate migration/re-authentication plan.

Next.js proxies `/api/v1` to `API_INTERNAL_ORIGIN`, default `http://127.0.0.1:4000`, in development and production. Set that value in the web process/build environment if the API is elsewhere. Cookies remain host-only and HTTP-only. Browser mutations require the trusted Origin and `X-CSRF-Token: 1`. No secrets are stored in browser local/session storage.

## Bootstrap the first owner

Create a private JSON file outside the repository containing `email`, `name` and an initial `password` (at least 10 characters, at most 1024 UTF-8 bytes). Do not put the password in shell arguments or chat. Run from the repository root, using the intended deployment's private environment:

```powershell
pnpm --filter @darjeeling/api bootstrap-owner --file C:\private\owner-bootstrap.json
```

The command refuses mock mode, an existing owner (including a development owner), or a previously used bootstrap marker. It never overwrites/promotes an existing account. Owner creation and its audit record commit in one transaction; concurrent bootstrap attempts have one winner. Remove the private input file through your normal secure credential-handling process after successful setup. No real owner is created by the application build or test suite.

Open `/admin`, sign in with the initial password, choose a different password and enrol a time-based authenticator using the manual setup key. Only after a valid six-digit code is confirmed does the API issue normal access/refresh cookies. Owner accounts always require 2FA. Ordinary staff may enable it in Security; an administrator's reset requires re-enrolment. Owner credential recovery is intentionally not exposed through ordinary staff routes; keep the encryption key and authenticator backup secure.

## Implemented staff flow

- `POST /admin/auth/login`: canonical email/password and optional `totpCode`; wrong credentials remain generic. Five failed attempts per account lock that account's current 15-minute window. Thirty total login attempts per IP per 15-minute window are allowed. Counters persist in MongoDB, use keyed hashes rather than raw account/IP values, and have TTL cleanup. `429` includes `Retry-After: 900` (a conservative retry interval).
- Pending password change or 2FA enrolment returns `{data:{nextAction,expiresInSeconds:600}}`. The only credential is `ds_enrol`, an HTTP-only cookie scoped to `/api/v1/admin/auth`. Its random value is stored hashed, expires after ten minutes and cannot authorize workspace requests or refresh. Login and account security changes invalidate older challenges.
- `GET /admin/auth/status` restores a pending step after reload. `POST /admin/auth/cancel` invalidates the challenge and clears the setup cookie.
- `POST /admin/auth/change-password` accepts `{newPassword}` on a restricted challenge. It rejects the old password, revokes existing sessions, clears the required-change state and either advances to enrolment or issues a normal session. It cannot be used as an unrestricted password-reset endpoint.
- `POST /admin/auth/2fa/setup` returns a manual secret and `otpauthUrl`. It accepts a restricted challenge after password change, or a normal staff session whose successful password login was within ten minutes. Setup is idempotent within the challenge; an enabled authenticator cannot be replaced through setup.
- `POST /admin/auth/2fa/enable` accepts `{code}`. Codes follow RFC 6238 SHA-1, six digits, 30-second steps, with a one-step clock window. Accepted steps cannot be reused. Five bad enrolment codes exhaust the challenge. The secret is encrypted with AES-256-GCM and authenticated to the user ID. Enable and audit commit together, and all previous normal sessions are revoked.
- `GET /me` and `GET /me/access` return current safe staff profile/grants/scope, including custom staff roles. Access and refresh recheck required credential state. Reset-password, reset-2FA, deactivate and force-logout revoke sessions and pending challenges; role/scope changes also invalidate pending challenges.

Authentication mutations and session issuance use the same transaction as their audit event. Audit failure returns a generic error and leaves credentials/sessions unchanged. Browser responses omit raw access/refresh/challenge tokens. The admin UI asks for confirmation before staff lifecycle/security actions, and forces a new sign-in when an action revokes the current user's session.

Passwords reuse the versioned salted scrypt format in F02. Encryption and TOTP use Node's standard crypto APIs; algorithm behavior is verified with [RFC 6238 vectors](https://www.rfc-editor.org/rfc/rfc6238) and [Node crypto documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html).

## Verification and limits

Run `pnpm --filter @darjeeling/api test`, `pnpm --filter @darjeeling/api test:integration`, `pnpm typecheck`, `pnpm check:boundaries` and `pnpm --filter @darjeeling/web build`. Integration tests use disposable databases and test-only credentials; they never create an owner in the configured deployment database.

The Staff screen accepts existing warehouse IDs because warehouse directory UI is not yet implemented. Backend scope and existence checks remain authoritative. Tests cover API flows, expiry, replay, reset enforcement, audit rollback and bootstrap concurrency. This implementation does not supply customer/rider SMS/WhatsApp delivery, F01 profile editing/devices/app-config endpoints, public forgotten-password recovery or deployment/HTTPS provisioning.
