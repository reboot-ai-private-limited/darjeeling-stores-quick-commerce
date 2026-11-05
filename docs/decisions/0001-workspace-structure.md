# ADR 0001: pnpm workspace with a modular API

Status: Implemented, recorded from current source rather than a historical approval record
Date: 2026-11-05
Owner: Repository maintainers
Last verified: 2026-11-05, manifests and composition source inspection

## Context

The repository needs an API and web application with shared TypeScript configuration and a small set of client-safe contracts. Customer and rider applications are planned. The initial product scale favors a single operational backend rather than independently deployed feature services.

## Decision

Use the existing pnpm workspace for applications and shared packages. Keep the Express API as a modular monolith, construct module dependencies explicitly, and keep listening/database initialization outside the app factory. Use the current Next.js application for planned storefront/admin routes.

`@darjeeling/shared` exports built JavaScript and declarations. `@darjeeling/config` exports TypeScript configuration. Mobile directories remain reserved until their runnable applications are introduced.

## Alternatives

There is no recorded historical evaluation of other package managers or repositories. Separate repositories would require an independent contract publication/versioning workflow. A source-only shared package could remove a local build step but would require every runtime/build consumer to support that resolution strategy. Neither alternative is being introduced by this record.

The product overview explicitly favors no microservices at launch. Splitting services would add deployment and distributed consistency work before current business modules exist.

## Consequences

Workspace dependencies establish build order. Focused API commands on a clean clone require shared output first. Keeping the app factory independent of process startup allows HTTP tests without MongoDB. Explicit composition keeps dependency wiring inspectable without a container framework.

Shared exports need care: server internals and secrets cannot be made client-safe by placing them in a common package. Modular boundaries still need automated checks and review; sharing a repository does not enforce ownership by itself.

## Revisit when

Revisit packaging if independently released clients need published shared contracts or build consumers cannot use the current export strategy. Revisit deployment boundaries when measured load, independent failure isolation or team ownership justifies the operational cost. Do not split services solely because more module folders exist.

## References

- [Root manifest](../../package.json) and [workspace configuration](../../pnpm-workspace.yaml).
- [Shared package exports](../../packages/shared/package.json).
- [Current architecture](../architecture/overview.md) and [dependency rules](../architecture/module-dependencies.md).
