# Runbook: Incident response

Status: Proposed
Owner: On-call/operator role to be assigned
Last verified: Not exercised in staging
Scope: Initial API/web/database diagnosis and safe escalation

## Trigger and preconditions

Use for unreachable services, repeated 5xx responses, readiness failures or reported user-impacting behavior. Identify environment and current revision before taking action. Obtain authorized read access to process logs and host/database status; no alerting service or contact roster is configured here.

## Diagnosis

For local development only, runnable from root PowerShell with the local API expected on port 4000:

```powershell
Invoke-WebRequest http://localhost:4000/api/v1/health
Invoke-WebRequest http://localhost:4000/api/v1/ready
docker compose -f docker-compose.dev.yml ps
```

Expected: health/readiness are 200 and local Mongo is healthy. A non-2xx response may raise a PowerShell error; record its status rather than assuming the diagnostic command itself is broken. Production diagnostics must use the selected host's actual endpoints and log tools.

| Observation | Interpretation | Next step |
| --- | --- | --- |
| Both endpoints unreachable | Process/proxy/network failure or startup prevented listening | Inspect supervisor and startup events |
| Health 200, ready 503 | Process responds; connection predicate unavailable | Inspect database availability/access and safe connection events |
| `database_connection_failed` at startup | Required connection did not initialize | Verify target network/access/configuration without printing URI secrets |
| Repeated `http_error` | Unexpected request failure | Correlate request IDs and recent revision; current logs omit detailed exceptions |
| `shutdown_failed` | Drain/disconnect failed or exceeded deadline | Inspect host termination timing and active work; do not assume graceful completion |

## Procedure

1. Record start time, scope, affected environment and observed symptom.
2. Check process, routed health/readiness and database status before restarting anything.
3. Identify a recent release/configuration change and preserve safe logs.
4. Apply the smallest understood recovery: repair availability/configuration or follow reviewed rollback. Do not delete volumes, caches or records as a generic fix.
5. Verify the actual affected workflow after probes recover. Reconcile ambiguous mutations when business writes exist.
6. Record cause, action, recovery evidence and a follow-up test/runbook correction.

## Verification and rollback

Require stable probes and the previously affected user action. A restart that temporarily clears a symptom is not root-cause evidence. Revert a recovery change through the same reviewed deployment/configuration mechanism if it worsens behavior; data restoration has separate risks.

## Escalation

Escalate unresolved production impact to assigned backend and deployment owners. Include environment, revision, time window, statuses, request IDs and redacted events. Exclude access tokens, OTPs, database URIs with credentials and customer payloads. Define actual contacts before launch.
