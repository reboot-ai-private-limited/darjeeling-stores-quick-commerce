# Darjeeling Stores

Darjeeling Stores is a planned quick-commerce service for customers, warehouse staff and salaried riders in hill-region delivery conditions. The current repository implements the backend foundation and a placeholder web page; commerce and mobile behavior remain designs.

## Applications and packages

| Path | Current role |
| --- | --- |
| `apps/api` | Express API, MongoDB lifecycle and health endpoints |
| `apps/web` | Next.js placeholder; intended storefront/admin application |
| `apps/customer-app`, `apps/rider-app` | Reserved mobile directories, not runnable applications |
| `packages/shared` | Built runtime constants and transport types |
| `packages/config` | Shared strict TypeScript configuration |

## Prerequisites

Use Node.js satisfying `>=22` and dependency engine requirements, pnpm 12.6.0, Git, and running Docker with Compose for the local database. From PowerShell, verify with `node --version`, `pnpm --version`, `git --version`, `docker version` and `docker compose version`. See [full setup](docs/engineering/setup-development.md) for platform limits and troubleshooting.

## Quickstart

From a clean checkout root in PowerShell, with prerequisites available and ports 27017/3000/4000 free:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @darjeeling/shared build
docker compose -f docker-compose.dev.yml up -d --wait
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/darjeeling_dev?replicaSet=rs0'
$env:CORS_ORIGINS = 'http://localhost:3000'
pnpm --filter @darjeeling/api dev
```

Expected: Mongo is healthy and the API logs `server_listening` on port 4000. The API reads process variables; copying `.env.example` does not load them automatically. Local Mongo is unauthenticated and loopback-bound, for development only.

In a second root PowerShell terminal, with installation complete:

```powershell
pnpm --filter @darjeeling/web dev
```

Expected: `http://localhost:3000` shows the setup-in-progress page. In another terminal while the API is running, `Invoke-RestMethod http://localhost:4000/api/v1/health` returns status `ok`; `/api/v1/ready` returns `ready` when Mongo is connected.

## Daily commands

From root with installed dependencies and shared output built:

| Command | Expected result |
| --- | --- |
| `pnpm dev` | Parallel API/web watchers; API environment must already be set |
| `pnpm typecheck` | Workspace type checks complete |
| `pnpm test` | Fast API tests run, excluding integration |
| `pnpm check:boundaries` | Backend dependency rules pass |
| `pnpm --filter @darjeeling/api test:integration` | API builds and disposable Mongo/process tests run; initial binary download may be needed |
| `pnpm build` | Shared/API and Next production artifacts build |

These are available checks, not claims of a clean CI result. Windows skips the process SIGTERM integration case. See [testing](docs/engineering/testing.md) for coverage and prerequisites.

## Documentation and contribution

Start at the [documentation index](docs/README.md). Read [architecture](docs/architecture/overview.md), [engineering/contribution guidance](docs/engineering/README.md), [API reference](docs/api/README.md), and the existing [product/feature overview](docs/00-overview.md). Active foundation work remains in [tasks/plan.md](tasks/plan.md) and [tasks/todo.md](tasks/todo.md); broader responsibilities remain in [Dev 1](dev1.md) and [Dev 2](dev2.md).

## Common failures

Missing shared output prevents API import resolution; absent `MONGODB_URI` prevents startup; unreachable Mongo prevents listening. Worker `spawn EPERM` means tests did not execute. Use the symptom-based [setup troubleshooting](docs/engineering/setup-development.md#troubleshooting) before changing dependencies or deleting data.

Stop watchers with Ctrl+C. From root, `docker compose -f docker-compose.dev.yml down` stops local infrastructure while retaining its data volume. Production deployment and restore remain unverified; see [operations runbooks](docs/runbooks/README.md).
