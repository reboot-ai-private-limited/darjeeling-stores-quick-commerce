# Development mock authentication

Status: Implemented development-only bypass; production authentication remains pending
Owner: Backend maintainers
Scope: Local OTP login, development owner, JWT access and rotating refresh cookies

## Enable

The local ignored root `.env` contains `NODE_ENV=development` and `mockOTP=true`. The API `dev` command loads that file through Node's env-file option; existing process environment values take precedence. Copy `.env.example` first on another checkout. Production startup does not load this file automatically.

`JWT_SECRET` is also required when mock OTP is enabled. It is a server-only runtime secret containing 64 hexadecimal characters generated from 32 random bytes. The current local `.env` has a generated key; it is ignored by Git. There is no built-in signing key. On a new checkout, after copying the example, run this from root PowerShell with Node installed and no existing JWT_SECRET entry:

```powershell
node --input-type=module -e 'import { randomBytes } from "node:crypto"; import { appendFileSync, readFileSync } from "node:fs"; const path = ".env"; if (/^JWT_SECRET=/m.test(readFileSync(path, "utf8"))) throw new Error("JWT_SECRET already exists; review key rotation explicitly"); appendFileSync(path, "\nJWT_SECRET=" + randomBytes(32).toString("hex") + "\n");'
```

Expected: the key is appended to the private environment file without being printed. Restart the API afterward. Changing the key invalidates access JWTs; stored refresh credentials can issue new access JWTs after that change. Revoke session families as well if responding to credential compromise.

Mock mode refuses any nondevelopment environment and any database name not ending in `_dev` or `_test`. It binds the API to loopback and logs that development mock OTP is enabled. Use a dedicated development database, never a production copy.

## Accounts and code

Phone `9000000001` is normalized to `+919000000001` and seeded as the development super admin with all-warehouse scope. Existing unrelated accounts are never promoted or overwritten. Other customer phones use the same code but receive customer accounts with no warehouse grants. Rider login is unavailable until preregistration policy is implemented.

Every mock login OTP is `000000`. A request is still required first. Challenges expire after five minutes and are consumed once, with five wrong attempts allowed. An active challenge cannot be repeatedly replaced. These controls do not constitute production abuse protection.

## Runnable local example

From root PowerShell, with a dedicated development MongoDB running and root `.env` configured:

```powershell
pnpm --filter @darjeeling/shared build
pnpm --filter @darjeeling/api dev
```

Expected: `development_mock_otp_enabled` and `server_listening` events. In a second PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/v1/auth/request-otp -Method Post -ContentType application/json -Body '{"phone":"9000000001","app":"admin"}'
$devSession = Invoke-RestMethod http://127.0.0.1:4000/api/v1/auth/verify-otp -Method Post -ContentType application/json -Body '{"phone":"9000000001","otp":"000000"}'
Invoke-RestMethod http://127.0.0.1:4000/api/v1/me -Headers @{Authorization="Bearer $($devSession.data.accessToken)"}
```

Expected: the profile reports `super_admin`. Keep the session token out of logs/chat. POST `/auth/logout` with the bearer header revokes that session family. These direct CLI requests retain bearer compatibility; browser requests use the cookie flow below.

## Dual token and browser cookie contract

### Environment configuration

These server runtime values are loaded from the private root `.env` by the development script. Restart the API after changing them. Existing session-family expiry is not extended retroactively; new access JWTs use the current access lifetime and claims.

| Variable | Local/default value | Validation and effect |
| --- | --- | --- |
| `JWT_SECRET` | Privately generated | 64 hex characters; never commit it |
| `ACCESS_TOKEN_TTL` | `30m` | Duration from 30s to 1h; JWT expiry, persisted access expiry, cookie Max-Age and response lifetime |
| `REFRESH_TOKEN_TTL` | `15d` | Duration from 1m to 30d, greater than access TTL; new family's absolute expiry and refresh cookie lifetime |
| `JWT_ISSUER` | `darjeeling-stores-api` | Nonempty string, up to 128 characters; signing and verification |
| `JWT_AUDIENCE` | `darjeeling-stores-clients` | Nonempty string, up to 128 characters; signing and verification |
| `AUTH_COOKIE_SECURE` | `false` in local `.env` | Literal true/false; defaults true in production and false otherwise; production false is rejected; secure requests also force Secure |
| `AUTH_COOKIE_SAME_SITE` | `strict` | strict/lax/none; none requires Secure |

Durations use a positive integer followed by `s`, `m`, `h` or `d`, such as `30m`, `1h` or `15d`. Bare numbers, fractions, negative values and unsupported units are rejected. Conversion to seconds/milliseconds is internal; API expiry metadata still reports seconds.

Both cookies always remain HTTP-only and host-only. Cookie names and API paths remain stable rather than becoming extra configuration. Changing issuer/audience invalidates old access JWTs; a valid refresh can issue replacements. These values do not change the fixed mock OTP code.

The access token is a signed HS256 JWT valid for 30 minutes by default, validated with configured issuer `darjeeling-stores-api`, audience `darjeeling-stores-clients`, `at+jwt` type and required subject, issue/expiry time and token identifier. Permissions are read from the current database role rather than trusted from JWT claims. Every access also checks the persisted session's current access hash and revocation/expiry, so JWT validation alone does not bypass logout.

The refresh token is a separate cryptographically random secret with a default absolute 15-day family lifetime. It is not a JWT. Both credentials are hashed with SHA-256 before persistence in `auth_sessions`; raw refresh secrets are never returned in JSON. The session TTL index is cleanup only: reads check expiry explicitly.

| Cookie | Attributes | Scope |
| --- | --- | --- |
| `ds_access` | HttpOnly, SameSite=Strict, Configured access Max-Age | `/api/v1` |
| `ds_refresh` | HttpOnly, SameSite=Strict, remaining family lifetime | `/api/v1/auth` |

Cookies are host-only, without a Domain attribute. Secure is enabled for secure requests or explicit secure-cookie composition; local HTTP development deliberately omits it. Production HTTPS/domain deployment is not implemented by the mock flow.

Browser requests identify themselves with `X-Client: admin`; successful verification returns the safe profile and access lifetime without either raw token. The UI sends credentials on same-origin requests through the Next development proxy. It stores no token in React state, localStorage or sessionStorage.

`POST /auth/refresh` requires the refresh cookie, an exact configured Origin, and `X-CSRF-Token: 1`. This is an explicit custom-header and trusted-origin CSRF policy, not a secret double-submit token. Browser verification and cookie logout enforce the same origin/header policy. A missing or untrusted origin cannot refresh or log out cookie sessions. Direct CLI cookie requests must set those headers too.

Refresh atomically rotates both credentials and invalidates the previous access token. Replay of a used refresh token revokes its entire session family, without revoking other families for the user. Concurrent refresh has one winner; the losing replay revokes that winner, forcing fresh sign-in. Replay history is bounded to 500 rotations per family, after which sign-in is required. A lost successful refresh response cannot safely retry the old token.

The browser helper retries a failed authenticated read once after refresh and serializes rotation within a tab. Web Locks coordinates across tabs where supported. Browsers without Web Locks can still encounter cross-tab refresh races and require sign-in. Reload restores the profile from the access cookie, refreshing first when necessary. Logout revokes persisted credentials and clears both cookies using their original paths. Failed server logout is reported; clearing the UI alone does not prove server revocation.

## Limits and cleanup

JWT access and hashed rotating refresh sessions now persist across API restarts. Mock OTP challenges remain process-local and disappear on restart. The browser login, session restore and logout are connected. Production password/2FA authentication, native refresh transport, complete abuse protection and deployment hardening remain pending. Do not treat fixed-code mock sign-in as production-ready authentication.

Disable with `mockOTP=false` and restart. Mock routes disappear; development sessions cease to work. Seeded records remain in the development database, tagged on the owner as `devMockAccount`. Production authentication must reject such mock identities unless an explicit reviewed migration removes that designation. Do not copy this database into production.

## Verification

Configuration tests cover fail-closed environment parsing. Disposable Mongo HTTP tests cover owner seed/login/logout, single use, wrong-attempt exhaustion, customer isolation, missing routes when disabled, invalid database targets and refusal to overwrite an existing owner phone.

Session tests additionally cover JWT claims/signatures, stored hashes, persistence across store recreation, expiry independent of TTL cleanup, atomic refresh, replay family revocation, cookie flags, logout cleanup and CSRF/origin failures. Browser helper unit tests cover concurrent refresh deduplication and failure handling; they do not replace real browser acceptance.

Implementation references: [jose signing and verification](https://github.com/panva/jose), [cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
