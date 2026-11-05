# Development mock authentication

Status: Implemented development-only bypass; production authentication remains pending
Owner: Backend maintainers
Scope: Local OTP login, development owner and temporary bearer sessions

## Enable

The local ignored root `.env` contains `NODE_ENV=development` and `mockOTP=true`. The API `dev` command loads that file through Node's env-file option; existing process environment values take precedence. Copy `.env.example` first on another checkout. Production startup does not load this file automatically.

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

Expected: the profile reports `super_admin`. Keep the session token out of logs/chat. POST `/auth/logout` with the bearer header removes the development session.

## Limits and cleanup

Tokens are random opaque development credentials, not production JWTs. Sessions expire after 15 minutes and disappear on API restart. There is no refresh endpoint or browser login UI. Challenges and sessions are bounded process-local maps. They are not a substitute for planned durable sessions, rate limiting, 2FA or CSRF protection.

Disable with `mockOTP=false` and restart. Mock routes disappear; development sessions cease to work. Seeded records remain in the development database, tagged on the owner as `devMockAccount`. Production authentication must reject such mock identities unless an explicit reviewed migration removes that designation. Do not copy this database into production.

## Verification

Configuration tests cover fail-closed environment parsing. Disposable Mongo HTTP tests cover owner seed/login/logout, single use, wrong-attempt exhaustion, customer isolation, missing routes when disabled, invalid database targets and refusal to overwrite an existing owner phone.
