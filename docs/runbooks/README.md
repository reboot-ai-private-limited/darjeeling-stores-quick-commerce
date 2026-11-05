# Operations runbooks

These runbooks are proposed operational procedures. No production host, automated release pipeline, backup schedule or restore drill is configured or verified by their existence.

| Situation | Runbook | Current limitation |
| --- | --- | --- |
| Release a tested revision | [Deployment](deployment.md) | Hosting-specific action and release ownership unresolved |
| Recover from a bad revision | [Rollback](rollback.md) | Requires preserved artifact and data-compatibility review |
| Validate recoverability | [Backup and restore](backup-and-restore.md) | Requires chosen backup tooling and disposable exercise |
| Diagnose service failure | [Incident response](incident-response.md) | Alerting, access and escalation contacts unresolved |

Before accepting production traffic, assign operator roles and validate these procedures in staging. Record environment, revision, observed result and limitations without attaching secrets or customer records.
