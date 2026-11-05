# Runbook: Backup and restore verification

Status: Proposed
Owner: Database/operator owner to be assigned
Last verified: No backup or restore exercise performed
Scope: Recovery acceptance; backup provider and tooling not yet selected

## Trigger

Use to establish recoverability before the first stateful release, periodically verify recovery, or plan restoration after confirmed corruption/loss. A replica set and a persistent Docker volume are not backups.

## Preconditions

Choose the backup service/tool, authorized operator, protected storage, retention, encryption and access policy. Agree recovery-point and recovery-time objectives with the business: how much recent data may be lost and how long restoration may take. No values are approved here.

Inventory database records and external media references together. A database backup cannot restore an object that was independently deleted from storage. Confirm the source backup's timestamp and compatibility with the restore target's Mongo version.

Restoring over a live database can destroy newer data. This runbook only authorizes planning and a separately provisioned disposable restore exercise; it does not provide an overwrite command. A real recovery needs an explicit affected-data and reconciliation plan.

## Diagnosis

Determine whether the incident is connectivity, application logic, corruption or data deletion before restoring. Record the last known correct state, affected collections/interval and the backup evidence available. Do not infer integrity merely because a backup job reported success.

## Disposable exercise

1. Select a representative nonproduction dataset and a backup method that preserves required indexes and transaction consistency.
2. Produce the backup and record timestamp, source identity, tool/version, protection and checksum or provider verification evidence.
3. Provision a separate authenticated/restricted disposable database. Confirm its identity independently before restore.
4. Restore using the chosen provider/tool procedure. Exact commands remain pending selection and validation; no fictitious `mongorestore` flags are prescribed.
5. Verify records, unique indexes, required schema versions and a real application read/write workflow.
6. Record elapsed time, data timestamp, failures and manual actions. Compare with the agreed recovery objectives.
7. Clean up the disposable target only after its identity is verified and exercise evidence retained.

## Verification

Require both data checks and application behavior. Future orders/payments/ledgers need invariant and reconciliation checks, not just collection counts. Record any unavailable media or external-provider state and how it will be recovered or reconciled.

## Rollback

A disposable exercise can be abandoned without touching the source. A real restore may lose later legitimate writes; preserve the original state where possible and review reconciliation before cutover. Do not promise an automatic reversal.

## Escalation

Provide backup timestamp, affected scope, target identity, expected data loss and exercise results to the assigned database/backend owners. Never attach credentials or raw customer records.
