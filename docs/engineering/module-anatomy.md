# Module anatomy and feature recipe

The health capability is the current reference module. Its public file exposes a router factory; composition supplies readiness. There are no implemented identity, settings or geography modules yet.

## Current composition

| File | Owns |
| --- | --- |
| [health.public.ts](../../apps/api/src/modules/health/health.public.ts) | Router factory and health/readiness transport behavior |
| [container.ts](../../apps/api/src/container.ts) | Construction of the public module object |
| [app.ts](../../apps/api/src/app.ts) | Middleware order, API prefix, mounting and fallback errors |
| [server.ts](../../apps/api/src/server.ts) | Environment, database initialization, listening and signals |

Keep module internals private. The public contract should expose supported actions rather than all implementation files. An export is an ongoing compatibility obligation for callers.

## Delivering a new capability

1. Read the feature specification and active foundation checklist. Resolve blocking business conflicts with the owning team before implementation.
2. Name the record owner, caller, input units, permission/scope requirements and success/failure outcomes.
3. Define the smallest public operation needed by real callers. Add shared transport types only when a client uses them.
4. Implement pure rules as functions. Add application orchestration and dependency ports only where database/provider behavior requires them.
5. Implement storage/provider adapters with explicit error and concurrency semantics. Preserve the owning module's writes.
6. Validate HTTP input, obtain trusted actor context and map results to the common error envelope. Client-provided role or scope fields are not trusted actor context.
7. Wire concrete dependencies in the composition root and mount transport adapters in app composition.
8. Add policy, HTTP and isolated persistence checks appropriate to the behavior. Verify import rules and update the feature/API/setup documents affected.

## Illustrative future layout

This tree is illustrative, not a requirement to create empty folders:

```text
src/modules/<capability>/
  <capability>.public.ts
  domain/             pure business rules when needed
  application/        supported actions and required ports
  infrastructure/     database/provider adapters
  interface/          HTTP parsing and mapping
```

Use the names recognized by [boundary configuration](../../apps/api/.dependency-cruiser.cjs) if introducing these layers. Renaming folders without updating the checker can silently remove coverage.

## Acceptance review

Trace one real request from transport to owned persistence and back. Check denied scope, invalid input, missing record, duplicate retry, concurrent loser and provider failure. An endpoint that succeeds only with ideal fixtures is incomplete when its feature requires those cases.

Use the [feature template](../templates/feature.md) for nontrivial states and contracts. Do not duplicate the full schema once machine-readable API generation exists; it is not configured today.
