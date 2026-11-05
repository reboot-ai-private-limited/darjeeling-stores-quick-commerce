# Development setup

Status: Implemented configuration; clean-clone procedure not yet executed for this document.
Owner: Repository maintainers
Last verified: 2026-11-05, manifests, Compose configuration and source inspection only.
Scope: Host-run API and web application with local MongoDB.

## Platform and prerequisites

The examples use PowerShell from the repository root. Windows is the current authoring environment. Linux/macOS have not been freshly exercised for this guide; the process signal integration test runs only outside Windows. Use Linux Node and pnpm inside WSL rather than mixing Windows and Linux binaries.

Install Node.js satisfying the root `>=22` engine, pnpm 12.6.0, Git and Docker Desktop or Docker Engine with Compose. The API uses Mongoose 9; verify the installed dependencies' engine requirements if choosing an older Node 22 patch. Docker must be running before local infrastructure starts.

Runnable prerequisite checks, from any PowerShell directory:

```powershell
node --version
pnpm --version
git --version
docker version
docker compose version
```

Expected: each prints its version; Docker reports a reachable server. The root [manifest](../../package.json) pins pnpm. Do not silently regenerate the lockfile with another package-manager version.

## Clone and install

Runnable from your parent projects directory after replacing `<repository-url>` with the actual clone URL:

```powershell
git clone <repository-url> darjeeling-stores
Set-Location darjeeling-stores
pnpm install --frozen-lockfile
pnpm --filter @darjeeling/shared build
```

Expected: installation leaves the lockfile unchanged and shared JavaScript/declarations appear under `packages/shared/dist`. The API imports that built package; its development watcher does not compile the shared package for you. A changed shared contract needs a rebuild.

## Initialize local infrastructure

Runnable from the repository root with Docker available and host port 27017 free:

```powershell
docker compose -f docker-compose.dev.yml up -d --wait
docker compose -f docker-compose.dev.yml ps
```

Expected: Mongo becomes healthy after replica set `rs0` initializes. Initialization is performed by the healthcheck in [Compose](../../docker-compose.dev.yml). The named volume keeps development data across restarts. The unauthenticated database binds to host loopback only and is unsuitable for production.

The advertised member address is `127.0.0.1:27017`; this configuration is for a host-run API. An API container needs an independently designed replica-set network address. Do not copy this topology into deployment unchanged.

## Configure the API terminal

The API reads `process.env`; it does not load `.env` automatically. [`.env.example`](../../.env.example) is a reference, not a startup mechanism. Runnable in the PowerShell terminal that will start the API:

```powershell
$env:PORT = '4000'
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/darjeeling_dev?replicaSet=rs0'
$env:CORS_ORIGINS = 'http://localhost:3000'
$env:TRUST_PROXY_HOPS = '0'
pnpm --filter @darjeeling/api dev
```

Expected: a `server_listening` JSON event after the database connects. If Mongo cannot be reached, startup records `database_connection_failed` and exits without listening. Environment values apply to this terminal and child processes, not a second terminal.

| Variable | Required/default | Classification | Meaning |
| --- | --- | --- | --- |
| `MONGODB_URI` | Required | Server-only runtime secret when credentials are present | Mongo connection target; never use production credentials for local work |
| `PORT` | 4000 | Server runtime | Integer 1–65535 |
| `CORS_ORIGINS` | Empty | Server runtime | Comma-separated exact HTTP(S) origins; no paths or trailing slash |
| `TRUST_PROXY_HOPS` | 0 | Server runtime | Nonnegative proxy-hop count; match the actual trusted network topology |

There are no implemented application-specific public web variables. Future `NEXT_PUBLIC_` values are publicly compiled configuration and must never contain secrets.

## Start the web terminal and check success

Runnable from the repository root in a second PowerShell terminal after dependencies are installed:

```powershell
pnpm --filter @darjeeling/web dev
```

Expected: the web page at `http://localhost:3000` says storefront setup is in progress. There is no implemented login, storefront catalog or admin panel. If Next selects another port because 3000 is busy, free the intended port or explicitly reconcile the allowed origin before implementing browser API calls.

Runnable in another root PowerShell terminal while the API is running:

```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
Invoke-RestMethod http://localhost:4000/api/v1/ready
```

Expected: status `ok` and `ready`, respectively. Readiness means Mongoose reports connected, not that a business transaction or provider is healthy.

After configuring the environment, `pnpm dev` can launch both workspace development processes in parallel. Separate terminals make individual logs and restarts easier to inspect.

## Checks and stopping

See [testing](testing.md) for commands, expected outcomes, disposable database behavior and Windows exclusions. See [build and deployment](build-and-deploy.md) before running compiled artifacts.

Stop each development watcher using Ctrl+C. The watcher and Windows console may affect signal delivery; do not treat this as proof of production SIGTERM handling. Runnable from root to stop local Mongo while preserving its named volume:

```powershell
docker compose -f docker-compose.dev.yml down
```

Expected: the container and Compose network stop; persisted data remains. Volume deletion is deliberately excluded from routine startup/stop procedures.

## Troubleshooting

| Symptom | Likely cause | Diagnosis | Smallest fix and recovery signal |
| --- | --- | --- | --- |
| Invalid configuration names `MONGODB_URI` | Variable absent in API terminal | Check presence without printing secrets: `Test-Path Env:MONGODB_URI` | Set it in that terminal; startup reaches database initialization |
| `database_connection_failed` | Mongo unavailable or incorrect URI | Run `docker compose -f docker-compose.dev.yml ps` from root | Start the configured database or correct the target; readiness becomes 200 |
| API cannot resolve shared package | Shared output missing | From root: `Test-Path packages/shared/dist/index.js` | Build shared package; API import succeeds |
| Port already allocated | Another application owns 27017, 3000 or 4000 | Inspect the relevant process using your OS tools; do not kill an unknown process | Stop the known conflicting service or consistently change configuration |
| Frozen install fails | Manifest and lockfile disagree or wrong pnpm | Run `pnpm --version` and inspect the Git diff | Use pinned pnpm; intentionally reconcile dependency changes rather than deleting the lockfile |
| Integration binary download fails | Network restriction or unavailable Mongo binary | Read the memory-server error and platform information | Permit the required download or use a supported cached binary; do not substitute a production URI |
| Vitest reports `spawn EPERM` | Worker process creation blocked | Compare execution policy/sandbox restrictions with the failed spawn | Run through the approved execution environment; no tests ran if worker startup failed |

No cache deletion is a general recovery step. Capture the first failing command and its actual error before changing the environment.
