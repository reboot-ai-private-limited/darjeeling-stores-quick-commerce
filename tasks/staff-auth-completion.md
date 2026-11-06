# Staff authentication and administration completion

Scope authorized by the request to complete staff login, owner bootstrap, 2FA/password enforcement and staff UI. Existing F01/F02 contracts remain the reference; customer/rider OTP delivery and unrelated profile/device endpoints are outside this change.

1. Credentials: reuse versioned scrypt; AES-256-GCM protects TOTP secrets using a separate environment key. RFC 6238 codes use a 30-second step and a one-step clock window; accepted steps cannot be reused.
2. Login: canonical email/password, durable per-account and per-IP attempt limits, active ordinary staff or owner only, reject development identities. Required password change and owner/reset 2FA enrolment receive only a hashed, expiring, HTTP-only restricted challenge. Normal access/refresh sessions are issued only after requirements finish. Refresh and protected routes recheck requirements and current account state.
3. Owner bootstrap: explicit local CLI reading credentials from a private JSON file; no public bootstrap endpoint, no default password, no real account created during implementation. A transaction and unique bootstrap marker permit only the first owner; bootstrap is audited. Owner must change the initial password and enrol 2FA before gaining access.
4. Admin UI: existing green/neutral visual system, email/password/code sign-in, reloadable restricted setup, manual authenticator key, staff search/filter/pagination, create/edit role and warehouse scope, and confirmed account actions. Show loading/error/empty states and labelled keyboard-accessible controls. Keep secrets out of storage/URLs/logs. Scope entry uses validated warehouse IDs because geography UI is not delivered.
5. Verification: credentials use RFC vectors and round-trip/error tests; HTTP integration covers login, lockout, CSRF, restricted challenge isolation/expiry/replay, reset transitions, owner bootstrap races and session revocation. Verify real browser and ARTEMIS mobile behavior against disposable data. Run API/web typecheck and build, API unit/integration suites and module boundary checks.

Implementation uses the current identity/access/audit module boundaries and installed dependencies. Build with `pnpm --filter @darjeeling/api build` and `pnpm --filter @darjeeling/web build`; verify with `pnpm typecheck`, `pnpm --filter @darjeeling/api test`, `pnpm --filter @darjeeling/api test:integration` and `pnpm check:boundaries`.

## Delivery and verification (2026-11-06)

Delivered staff authentication, restricted password/TOTP transitions, explicit owner bootstrap, current staff access/profile, production cookie session routes, the Staff/Security screens and production web/API proxy configuration. Existing local work was retained; no real owner or deployment secrets were created.

API unit and full integration suites passed, followed by focused checks for fresh TOTP login, replay, account/IP limits, independent encryption keys and custom-role browser-session restore. API/web type checks, API/web production builds and dependency boundaries passed. One existing Windows SIGTERM test is skipped because Windows does not provide that POSIX behavior.

Live UI verification remains blocked by the environment: the browser access host is unavailable; native browser automation could not safely obtain a usable window state; the Android emulator's UIAutomator/screen capture service did not respond after diagnostic recovery. ARTEMIS's recommended helper reinstall was blocked by Windows Application Control (OS error 4551). No mobile UI tests or visual acceptance are claimed.
