# Build and deployment

Status: Implemented build scripts; production release procedure proposed.
Owner: Repository maintainers / deployment owner to be assigned
Last verified: 2026-11-05, package scripts and bootstrap source inspection only.
Scope: Build artifacts, runtime requirements and release acceptance.

## Build artifacts

Runnable from root with the pinned toolchain and frozen dependencies installed:

```powershell
pnpm build
```

Expected: shared `dist` with declarations, API `dist` JavaScript, and a Next production build under `apps/web/.next`. Recursive ordering builds declared dependencies first. There is no standalone Next output setting, API bundler or production container recipe.

The compiled API still imports installed packages, including the shared workspace package. Copying `apps/api/dist` alone is insufficient. Keep the package manifests, correct production dependency installation and shared build available to the runtime, or create and verify an explicit packaging strategy.

## Local compiled startup

Runnable from root after a successful build and the same API runtime variables/database described in [setup](setup-development.md):

```powershell
pnpm --filter @darjeeling/api start
```

Expected: database connection followed by a listening event. In a second root terminal after the web build:

```powershell
pnpm --filter @darjeeling/web start
```

Expected: the production Next server serves the placeholder on its configured/default port. These are foreground commands; a hosting supervisor is a separate deployment choice.

## Production prerequisites

Choose the hosting target, domains, TLS termination, process supervisor, secret store, database access policy and logging destination before release. Configure exact CORS origins and proxy hops from the real topology. Prevent direct untrusted access from bypassing the proxy assumptions.

Do not deploy the development Compose database as a production database. Production needs authentication, restricted network access, durable storage, backups and an exercised restore. A hosting platform or Atlas account is not configured by this repository.

The process supervisor should use liveness and readiness for their distinct purposes and allow the application's ten-second shutdown budget plus operational margin. Verify SIGTERM in the actual host; Windows unit results are not substitute evidence.

## Release flow

1. Identify the revision and record frozen dependency/build outputs.
2. Run fast tests, typechecking, import checks and the isolated integration suite in the release environment or a compatible CI environment.
3. Review contract and data compatibility with the previous release. There are no business migrations today; future migrations need explicit forward/backward behavior.
4. Deploy to staging with staging secrets and database. Verify compiled startup, health, readiness, safe errors, logs and termination.
5. Establish rollback artifacts and a verified backup where data changes require one.
6. Release using the chosen host procedure, then verify actual user behavior and monitor errors.

No production CI/CD pipeline exists, and these steps are not an executable platform deployment command. [Deployment](../runbooks/deployment.md), [rollback](../runbooks/rollback.md) and [restore](../runbooks/backup-and-restore.md) capture proposed operational checks and stop conditions.
