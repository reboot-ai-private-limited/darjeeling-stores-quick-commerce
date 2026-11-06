# F01 remaining endpoints

Scope: complete the nine remaining F01 endpoint handlers and native session transport while retaining staff authentication and existing browser cookies. User explicitly requested fixed OTP `000000` only with `mockOTP=true` and `NODE_ENV=development`; live WhatsApp/SMS delivery is deferred.

1. Durable OTP: separate login/phone-change purposes, keyed hashes, expiry in queries, single consumption in a transaction, persistent phone/IP quotas and failed-attempt lockout. Rider login requires an active pre-registered rider; account kind cannot be selected by verification input. Mock staff-owner login remains explicitly development-only. Outside mock mode no fixed code is accepted and missing delivery transport returns 503.
2. Own profile: allowlisted name/email edits, safe customer defaults, authenticated customer-only phone verification bound to user/current phone/credential revision, unique phone/email conflicts. Phone change ends other sessions. Deletion requests revoke all sessions and invalidate pending challenges; final deletion remains F25.
3. Devices: validated token/platform/app/version; one owner per token, app matches account kind, caller-owned removal, no foreign token deletion or transfer.
4. Sessions: native customer/rider refresh tokens in JSON with explicit native client headers; browser secrets stay in HTTP-only cookies. Origin/cookies always trigger CSRF checks. Refresh reuse revokes all user sessions per F01. Existing access checks reject inactive customers/riders as well as staff.
5. App config: typed allowlisted deployment configuration, strict release-version comparison, rider Android/customer Android+iOS support, no invented support/download values. Maintenance blocks business endpoints with 503 while config and health/readiness remain available. Dynamic scoped settings/UI remain D1-3.

Verification: focused Vitest/Supertest tests against disposable MongoDB replica sets, including concurrency, expiry, lockout, ownership, resets and browser/native isolation; then full API tests, build/typecheck, web typecheck and module boundaries. No customer/rider mobile app exists to exercise; this change authors HTTP tests rather than mobile UI scripts.

Affected code: identity domain/OTP/profile/device services and routes, session store/transport, user schema, public app-config module, server/app configuration, tests and F01 documentation. Reuse current audit and role-assignment transaction protocols; do not change Dev 2 modules or add dependencies. Never read or change private owner/deployment credentials for this work.

Implemented: all 16 F01 endpoint handlers. HTTP coverage includes native/browser isolation, persistent lockout, single-consumption and phone-claim concurrency, device ownership, deletion revocation, production provider absence, injected transport fallback and transactional rollback on audit failure. Real provider wiring remains deliberately deferred. Existing generated web tsbuildinfo changes predate this task.

Validation completed: 66 API unit tests and 151 integration tests passed; one existing Windows SIGTERM test is skipped. API build, web typecheck, module boundaries and diff whitespace checks passed. No real SMS/WhatsApp delivery or mobile UI acceptance was performed.
