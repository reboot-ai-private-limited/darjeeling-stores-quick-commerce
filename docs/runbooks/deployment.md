# Runbook: Deployment

Status: Proposed
Owner: Deployment owner to be assigned
Last verified: Not executed; source/configuration comparison only
Scope: Release acceptance for API and web; platform-specific deployment pending

## Trigger

Use when a reviewed revision is ready for staging or production release. This procedure does not create hosting infrastructure or select production business settings.

## Preconditions

Identify the target environment, release revision, previous working artifact and authorized operator. Confirm secret injection, authenticated/restricted MongoDB, domain/TLS routing and proxy topology. For a stateful upgrade, establish backup freshness and restore evidence before changing data.

Stop if the intended host, rollback target or migration compatibility is unknown. Do not use the unauthenticated development Compose deployment as the production database.

## Diagnosis and preparation

Runnable from a checked-out release root in PowerShell with frozen dependencies, supported Node/pnpm and disposable Mongo binary access:

```powershell
pnpm --filter @darjeeling/shared build
pnpm typecheck
pnpm test
pnpm check:boundaries
pnpm --filter @darjeeling/api test:integration
pnpm build
```

Expected: every command exits zero; record platform-specific skips. Execute sequentially and stop on the first failure. On Windows, obtain separate non-Windows SIGTERM evidence before declaring termination verified.

## Procedure

1. Build and retain immutable artifacts and the dependency resolution used to create them.
2. Inject target runtime configuration through the selected secret mechanism, without exposing it in logs.
3. Apply only reviewed, compatible data/index changes. No production migration tool exists today; stop if a release requires an undefined migration procedure.
4. Start the new API using the chosen supervisor and the web using the chosen host. Exact host commands are pending platform selection.
5. Verify startup, liveness and readiness through the real proxy route before sending traffic. Stop on readiness failure or unexpected error rates.
6. Record revision, environment, time, operator and safe verification evidence.

## Verification

Use the externally routed health and readiness endpoints and inspect safe structured logs. Check the web page and any implemented user journey affected by the release. Current health success does not demonstrate a future checkout or session flow.

## Rollback

Follow [rollback](rollback.md) if application behavior regresses. A code rollback cannot undo incompatible database changes or external payment effects.

## Escalation

Notify the assigned deployment owner through the agreed operational channel; no contact is configured here. Provide revision, failing step, status codes, request IDs and redacted event logs. Exclude environment dumps and credentials.
