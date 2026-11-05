# pnpm and task execution

This repository uses pnpm workspaces. Turbo is not installed or configured; a local `.turbo` directory is not evidence of a task pipeline or cache contract.

## Workspace configuration

[Root manifest](../../package.json) pins pnpm 12.6.0. [Workspace configuration](../../pnpm-workspace.yaml) includes `apps/*` and `packages/*` and permits the esbuild build script through `allowBuilds`. Keep pnpm-version-specific settings in the actual configuration file rather than copying old `.npmrc` guidance.

Runnable from the repository root after dependencies are installed:

```powershell
pnpm build
pnpm typecheck
pnpm test
pnpm check:boundaries
```

Expected: each exits zero when its checks pass. These commands do not imply integration tests, browser tests or CI ran. `--if-present` skips packages lacking a script; it does not establish coverage for placeholder applications.

## Execution order and focused commands

Recursive build respects declared workspace dependencies. API depends on shared, whose export points to `dist`; build shared before direct API commands on a clean clone. Root `dev` uses parallel execution so long-running watchers do not prevent another app from starting.

Runnable from root after installation and shared build:

```powershell
pnpm --filter @darjeeling/api test
pnpm --filter @darjeeling/api build
pnpm --filter @darjeeling/web typecheck
pnpm --filter @darjeeling/shared build
```

Expected: only the named package's script executes. A filter is not an automatic request to build dependencies. Direct API integration execution also needs shared output already present.

## Lockfile and caches

Use frozen installation for reproducible dependency resolution. Dependency changes update manifests and `pnpm-lock.yaml` together. The pnpm store, Next output and TypeScript incremental files are implementation caches, not substitutes for checking a clean build.

No remote task cache, Turbo dependency graph or cache invalidation policy exists. If Turbo is introduced, document actual inputs, outputs and environment hashing and verify a cold build before promising cache behavior.
