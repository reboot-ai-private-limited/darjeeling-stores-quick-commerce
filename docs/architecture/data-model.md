# Persistence and consistency

Status: Implemented connection infrastructure; business collections proposed.
Owner: Backend maintainers
Last verified: 2026-11-05, database helper and integration-test source inspection.
Scope: Current MongoDB configuration and interpretation of existing model designs.

## Current persistence

[Mongo lifecycle helper](../../apps/api/src/shared/db/mongo.ts) uses the default Mongoose connection. Startup awaits connection before HTTP listening. Readiness reads `mongoose.connection.readyState === 1`. Shutdown awaits disconnect after HTTP closes.

No application schemas, collection migrations, business indexes, seed command or owner bootstrap exist. The [existing data-model document](../01-data-model.md) defines proposed entities and conventions; it is not a database inventory. Do not create collections from that document without implementing their owning rules and tests.

## Development and test databases

Local Compose runs MongoDB 8.0.16 with replica set `rs0` and a persistent named volume. The API runs on the host. This enables transaction development while avoiding external cluster credentials. It provides neither authentication nor high availability.

Integration tests create their own `MongoMemoryReplSet` processes. The URI is generated internally and the test databases are named `darjeeling_integration_test` and `isolated_test`; the application URI is not used as their data target. Do not add an environment override that could redirect cleanup to a real database without a separately reviewed safety guard.

The [Mongo integration test](../../apps/api/test/integration/mongo.test.ts) checks insert/read, unique-index rejection and aborted transaction rollback. Its test collections are `index_checks` and `transaction_checks`. These are not proposed business collections.

## Business data conventions

The authoritative proposed conventions remain in the [existing model design](../01-data-model.md): money in integer paise, weight in integer grams, UTC timestamps, business windows in `Asia/Kolkata`, and phones in E.164 form. Use explicit units at API boundaries; formatted display strings should not become persisted monetary values.

Order snapshots, scope identifiers, archive behavior and media references must be implemented by their owning features. Existing conflicting deletion language is recorded in [Dev 1](../../dev1.md) and needs resolution before catalog/media writes. Do not treat the general model document as permission to delete records.

## Consistency obligations for new writes

1. Name the module owning the record and the invariant it enforces.
2. Define unique and query indexes alongside the query patterns.
3. Use conditional atomic updates for single-document contention; define the losing caller's response.
4. Use a transaction where a business effect requires multiple records to commit together. Include every required operation in the session.
5. Specify idempotency and recovery when an external provider cannot share that transaction.
6. Verify contention and retries against an isolated replica set, rather than only mocking the repository.

Transactions do not automatically include HTTP calls, push notifications or files. A crash between commit and a side effect requires durable publication/repair design; no such mechanism exists yet.

## Indexes, migrations and restore

There is no implemented production index deployment or schema migration process. Before the first stateful release, establish ownership of index creation, compatibility across releases, backup evidence and restore acceptance. Do not run destructive schema cleanup during ordinary application startup.

The [backup and restore runbook](../runbooks/backup-and-restore.md) is a proposed exercise with explicit missing inputs. A replica set by itself is not a backup.
