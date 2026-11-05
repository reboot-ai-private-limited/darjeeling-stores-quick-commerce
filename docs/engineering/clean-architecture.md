# Clean architecture in the API

The dependency rule keeps business policy independent of HTTP, storage and process configuration. It makes policy testable without starting MongoDB and prevents a storage adapter from becoming the authority for unrelated business decisions.

## What exists today

The [health router](../../apps/api/src/modules/health/health.public.ts) receives an `isReady` function. It does not import Mongoose. [Container wiring](../../apps/api/src/container.ts) builds the router, [app composition](../../apps/api/src/app.ts) mounts it, and [server bootstrap](../../apps/api/src/server.ts) supplies the real database readiness implementation.

This is sufficient for the current capability. There is no health repository, use-case class or dependency-injection framework because none is needed.

## Responsibilities as business modules land

| Layer | Responsibility | Dependencies |
| --- | --- | --- |
| Domain | Invariants, allowed transitions and pure calculations | Business values and pure code |
| Application | One action, authorization coordination, transaction/idempotency policy | Domain and narrow ports |
| Infrastructure | Mongo/provider implementations of required capabilities | Database/SDK dependencies and inward contracts |
| Interface | HTTP input parsing, actor extraction and response mapping | Application operations and transport schema |
| Composition | Construct adapters and supply operations | Public module contracts and concrete implementations |

These responsibilities are conventions for new capabilities; only the small health module exists. Create folders when their responsibilities become real, not as an empty scaffold.

## Boundaries and failure behavior

An HTTP adapter validates untrusted input before invoking the action. An application action still enforces rules that must hold for every caller, including jobs and administrative commands. A repository adapter translates persistence results but does not decide whether a caller is permitted to change another warehouse's stock.

A TypeScript interface describes a compile-time contract. It does not authenticate a caller, protect a route or make a transaction atomic. Runtime checks and explicit session boundaries provide those guarantees.

Cross-module calls use public operations and preserve the owning module's validation. Directly updating another module's collection can bypass audit, scope and state-transition rules. Compose an operation rather than exporting raw write access for convenience.

## Enforcement and limits

[Dependency rules](../architecture/module-dependencies.md) describe the executable import checks and their limitations. Code review also checks process globals, hidden database calls and missing runtime validation; import direction alone cannot establish correctness.

For a new feature, follow [module anatomy](module-anatomy.md). Keep a pure function pure when a class or interface adds no needed boundary.
