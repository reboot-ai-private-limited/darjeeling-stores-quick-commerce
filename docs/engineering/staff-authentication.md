# Staff authentication and owner setup

Staff email/password sign-in, temporary-password changes, cookie refresh/logout and F02 administration are implemented. There is no two-factor step and no audit log. Customer/rider OTP delivery remains separate work. The admin web workspace exposes Staff and Roles & permissions according to the current session's permissions.

## Configure

Use a MongoDB replica set. Configure `MONGODB_URI`, a random 32-byte hex `JWT_SECRET`, and exact browser origins in `CORS_ORIGINS`. Generate the key with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the key in the private `.env` or deployment secret store. Never commit it. Production uses `NODE_ENV=production`, `mockOTP=false`, `AUTH_COOKIE_SECURE=true` and HTTPS. Configure trusted proxy hops to match the deployment; client-IP limits depend on that boundary. Changing the signing key signs everyone out.

Next.js proxies `/api/v1` to `API_INTERNAL_ORIGIN`, default `http://127.0.0.1:4000`, in development and production. Set that value in the web process/build environment if the API is elsewhere. Cookies remain host-only and HTTP-only. Browser mutations require the trusted Origin and `X-CSRF-Token: 1`. No secrets are stored in browser local/session storage.

## Bootstrap the first owner

Create a private JSON file outside the repository containing `email`, `name` and an initial `password` (at least 10 characters, at most 1024 UTF-8 bytes). Do not put the password in shell arguments or chat. Run from the repository root, using the intended deployment's private environment:

```powershell
pnpm --filter @darjeeling/api bootstrap-owner --file C:\private\owner-bootstrap.json
```

The command refuses mock mode, an existing owner (including a development owner), or a previously used bootstrap marker. It never overwrites/promotes an existing account. Owner creation commits in one transaction; concurrent bootstrap attempts have one winner. Remove the private input file through your normal secure credential-handling process after successful setup. No real owner is created by the application build or test suite.

Open `/admin`, sign in with the initial password and choose a different password. Only then does the API issue normal access/refresh cookies. An administrator's password reset gives a new temporary password that must be changed the same way. Owner credential recovery is intentionally not exposed through ordinary staff routes.

## Implemented staff flow

- `POST /admin/auth/login`: canonical email/password; wrong credentials remain generic. Five failed attempts per account lock that account's current 15-minute window. Thirty total login attempts per IP per 15-minute window are allowed. Counters persist in MongoDB, use keyed hashes rather than raw account/IP values, and have TTL cleanup. `429` includes `Retry-After: 900` (a conservative retry interval).
- A pending temporary-password change returns `{data:{nextAction,expiresInSeconds:600}}`. The only credential is `ds_enrol`, an HTTP-only cookie scoped to `/api/v1/admin/auth`. Its random value is stored hashed, expires after ten minutes and cannot authorize workspace requests or refresh. Login and account security changes invalidate older challenges.
- `GET /admin/auth/status` restores a pending step after reload. `POST /admin/auth/cancel` invalidates the challenge and clears the setup cookie.
- `POST /admin/auth/change-password` accepts `{newPassword}` on a restricted challenge. It rejects the old password, revokes existing sessions, clears the required-change state and issues a normal session. It cannot be used as an unrestricted password-reset endpoint.
- `GET /me` and `GET /me/access` return current safe staff profile/grants/scope, including custom staff roles. Access and refresh recheck required credential state. Reset-password, deactivate and force-logout revoke sessions and pending challenges; role/scope changes also invalidate pending challenges.

Browser responses omit raw access/refresh/challenge tokens. The admin UI asks for confirmation before staff lifecycle/security actions, and forces a new sign-in when an action revokes the current user's session.

Passwords reuse the versioned salted scrypt format in F02. Hashing uses Node's standard crypto APIs ([documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html)).

## Verification and limits

Run `pnpm --filter @darjeeling/api test`, `pnpm --filter @darjeeling/api test:integration`, `pnpm typecheck`, `pnpm check:boundaries` and `pnpm --filter @darjeeling/web build`. Integration tests use disposable databases and test-only credentials; they never create an owner in the configured deployment database.

The Staff screen accepts existing warehouse IDs because warehouse directory UI is not yet implemented. Backend scope and existence checks remain authoritative. Tests cover API flows, expiry, reset enforcement and bootstrap concurrency. This implementation does not supply customer/rider SMS/WhatsApp delivery, F01 profile editing/devices/app-config endpoints, public forgotten-password recovery or deployment/HTTPS provisioning.
