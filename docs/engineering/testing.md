# Testing and verification

Tests are separated by dependency and environment. Passing fast HTTP tests does not prove MongoDB startup, graceful process termination, provider delivery or device behavior.

## Check inventory

| Layer | Source | Dependency | Verifies |
| --- | --- | --- | --- |
| Fast HTTP/config | [API test directory](../../apps/api/test) | Supertest and Vitest | Health, injected readiness, CORS, JSON errors and environment validation |
| Shutdown helper | [Shutdown tests](../../apps/api/test/shutdown.test.ts) | Temporary local listener | Listener closure order and disconnect deadline |
| Mongo integration | [Mongo tests](../../apps/api/test/integration/mongo.test.ts) | Disposable replica set | Writes/reads, unique index and transaction rollback |
| Process integration | [Lifecycle tests](../../apps/api/test/integration/lifecycle.test.ts) | Compiled API and disposable replica set | Failed database startup, ready response and non-Windows graceful SIGTERM |
| Import boundaries | [Checker configuration](../../apps/api/.dependency-cruiser.cjs) | Dependency-cruiser | Configured cycles, layers and module access |
| Type/build | Package scripts | TypeScript and Next.js | Source compatibility and compilation |

## Fast checks

Runnable from root with dependencies installed and shared output built:

```powershell
pnpm test
pnpm typecheck
pnpm check:boundaries
```

Expected: exit code zero for each. [Fast Vitest configuration](../../apps/api/vitest.config.ts) excludes integration tests. A root fast-test pass does not include mobile or browser execution; those runners do not exist.

Application typechecking covers API `src`; Vitest transforms test files for execution. Do not describe this as a dedicated compile-time check of every test source.

## Isolated integration checks

Runnable from root after installation and shared build, with worker/process creation permitted and network access for an initial Mongo binary download:

```powershell
pnpm --filter @darjeeling/api test:integration
```

Expected: API compilation followed by tests against internally created local replica sets. [Integration configuration](../../apps/api/vitest.integration.config.ts) disables file parallelism. The suite does not require Docker or use the application's database URI as a test data target.

The first run may download a MongoDB executable. This is a real local database process, not an in-memory mock of Mongo behavior. Its version is selected by memory-server defaults/configuration and is not automatically the Compose image version; pin and align deliberately if version-specific behavior matters.

On Windows the graceful SIGTERM process case is explicitly skipped. The readiness case still starts a child API and terminates it during cleanup; that forced cleanup is not a graceful signal assertion. Run the suite on Linux/macOS or Linux Node inside WSL for that specific acceptance evidence.

## Build checks

Runnable from root with installed dependencies:

```powershell
pnpm build
```

Expected: shared/API output and a successful Next production build. It does not contact a production provider or prove deployment configuration. [Build guidance](build-and-deploy.md) describes artifacts and startup.

## Writing useful tests

Test the invariant and externally observable result, including the rejected case. Database races, single-use tokens, financial updates and multi-record consistency need real persistence checks when those features land. Fake providers isolate application behavior; keep sandbox evidence separate.

Explicitly wait for readiness or a defined state instead of inserting arbitrary long sleeps. Bound polling and collect safe process output when startup fails. Preserve cleanup in failure paths so disposable databases and child listeners do not remain running.

Before authoring mobile UI tests, follow [mobile exploration requirements](mobile.md). No mobile test can be claimed verified from proposed screen descriptions.

## Evidence and limitations

Record command, environment, revision, result and intentional skips. A worker `spawn EPERM` means tests did not execute. A successful source review is evidence about the inspected implementation, not a fresh-checkout walkthrough or restore drill.

Documentation formatting/link/schema checks and a clean CI setup run are proposed, not configured gates. When adding them, first prove deliberate broken fixtures fail and valid documents pass, then remove the temporary failures.
