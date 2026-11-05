# Runbook: Rollback

Status: Proposed
Owner: Deployment owner to be assigned
Last verified: Not executed
Scope: Application revision rollback; database restoration is a separate operation

## Trigger

Use when a new release causes a confirmed regression and the previous artifact is known to work with current stored data and external contracts.

## Preconditions

Identify the failing revision, last known working artifact, deployment mechanism and affected workflows. Review schema, index, shared contract and provider changes between them. Preserve safe incident evidence and prevent additional harmful mutations if required by the incident.

Stop if the old code cannot read current data, if a rollback would repeat financial effects, or if no known artifact is available. Escalate for a forward fix or reviewed recovery instead of improvising destructive database edits.

## Diagnosis

Compare failures before and after release using health/readiness, process logs, request IDs and user symptoms. Database unavailability may be independent of application revision; rolling back code alone will not repair it.

## Procedure

1. Confirm rollback scope and compatibility with the responsible backend/deployment owners.
2. Preserve current logs and identify any in-progress operations that need reconciliation.
3. Restore the preserved application artifact through the chosen hosting mechanism. Platform commands remain undefined until hosting is selected.
4. Terminate the replaced API with the supported graceful mechanism and respect the shutdown deadline.
5. Verify the old revision starts against current configuration/data before restoring traffic.
6. Reconcile actions that may have completed during the failure window; do not blindly retry ambiguous writes.

## Verification

Confirm the actual running revision, routed readiness, web behavior and the previously failing action. Compare logs and operational totals where business features exist. A 200 health response alone does not close the incident.

## Rollback limitations

Application rollback does not reverse data mutations, delivered notifications, uploaded files or provider operations. Do not restore an old database over newer legitimate transactions without an explicit loss/reconciliation plan. Use the [restore runbook](backup-and-restore.md) only when database recovery is the chosen operation.

## Escalation

Collect revision identifiers, compatibility concerns, affected interval and safe evidence for the deployment/backend owners. Named contacts and approval routing must be supplied before production operation.
