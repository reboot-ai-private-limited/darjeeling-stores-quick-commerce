# Monorepo layout

The workspace has two runnable applications and two shared packages. Mobile directories are reserved and have no package manifests. The filesystem, not the planned product diagram, determines the current inventory.

| Path | Role | Entrypoint or configuration |
| --- | --- | --- |
| `apps/api` | Express process and feature modules | [server](../../apps/api/src/server.ts), [app](../../apps/api/src/app.ts) |
| `apps/web` | Next.js App Router placeholder | [layout](../../apps/web/src/app/layout.tsx), [page](../../apps/web/src/app/page.tsx) |
| `apps/customer-app` | Planned customer native application | [Current notes](../../apps/customer-app/README.md) |
| `apps/rider-app` | Planned rider native application | [Current notes](../../apps/rider-app/README.md) |
| `packages/shared` | Runtime constants and transport types | [Exports](../../packages/shared/src/index.ts) |
| `packages/config` | Shared strict TypeScript configuration | [Compiler settings](../../packages/config/tsconfig.json) |
| `docs` | Current references and existing feature designs | [Documentation index](../README.md) |
| `tasks` | Active foundation plan and execution checklist | [Plan](../../tasks/plan.md), [checklist](../../tasks/todo.md) |

## Placement rules

Keep a business rule in its owning API module. Do not place Mongoose models, server secrets or authorization implementations in the shared client package. Add a shared DTO only when a real consumer needs that contract; importing a TypeScript type is not runtime validation.

Keep application wiring in `container.ts`, HTTP-wide middleware in `app.ts`, and process/database initialization in `server.ts`. Put module-specific HTTP adapters with that module. The health public file is intentionally small; it is not a mandate for every capability to have four folders.

Keep fast tests in `apps/api/test` and database/process integration tests in `apps/api/test/integration`. API TypeScript configuration includes `src`, so production builds do not compile test files. Vitest execution and application typechecking are separate checks.

Generated `dist`, `.next`, dependency directories and logs are not source. Do not commit them as a workaround for a missing build. The lockfile is source and changes with intentional dependency updates.

## Adding an application or package

Add a manifest under the workspace globs in [workspace configuration](../../pnpm-workspace.yaml). Define only scripts that actually run, choose exports for shared runtime packages, and establish build order through declared dependencies. Update this inventory, setup, root commands and deployment artifact guidance together.

There is no `apps/site`, Turbo pipeline or separate admin application in this repository. The intended admin route belongs to the existing web app, but it is not implemented.
