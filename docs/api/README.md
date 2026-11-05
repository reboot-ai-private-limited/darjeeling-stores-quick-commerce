# API reference and contract policy

## Development mock OTP exception

With explicit `NODE_ENV=development` and `mockOTP=true`, local-only mock request/verify OTP, profile and logout routes are available. Phone `9000000001` uses `000000` as the development super-admin OTP; other customer phones use that code without admin privileges. These routes use temporary opaque bearer sessions and do not implement production F01 JWT/refresh/2FA contracts. See [development authentication](../engineering/development-auth.md) for database guards, startup and limits. The production endpoint inventory below remains unchanged when mock mode is disabled.

Status: Implemented foundation endpoints.
Owner: Backend maintainers
Last verified: 2026-11-05, app/router/shared types and test source inspection.
Scope: Existing HTTP routes, errors, CORS and future schema ownership.

## Planned business endpoints

The upstream [proposed endpoint catalog](planned-endpoints.md) and [business API conventions](00-conventions.md) preserve the per-feature API designs and proposed conventions. Those contracts remain proposals; where they differ from current middleware or routes, this implemented reference describes current behavior.

## Source of truth

Current routes are defined by [health.public.ts](../../apps/api/src/modules/health/health.public.ts); middleware and errors by [app.ts](../../apps/api/src/app.ts). [Shared exports](../../packages/shared/src/index.ts) define the prefix and error TypeScript type. No OpenAPI generator or schema validation pipeline exists. The examples below describe source behavior; they are not generated contracts.

The default local base URL is `http://localhost:4000/api/v1`. All currently implemented routes are public. No authentication, session, pagination, idempotency or business mutation endpoint exists.

## Health endpoints

| Request | Success response | Other outcome | Meaning |
| --- | --- | --- | --- |
| `GET /health` | 200, `{"status":"ok"}` | Transport/process failure | HTTP process can respond |
| `GET /ready` | 200, `{"status":"ready"}` | 503, `{"status":"unavailable"}` | Injected readiness predicate reports availability |

Runnable from root PowerShell with the configured API running:

```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
Invoke-RestMethod http://localhost:4000/api/v1/ready
```

Expected: `ok` and `ready` status properties when MongoDB is connected. Readiness is the default Mongoose connection state, not a fresh ping, index check or transaction test. See [health design](../features/health-and-readiness.md).

## Request IDs and errors

Every request passing app middleware gets a server-generated UUID in `X-Request-Id`. Incoming IDs are not reused. Error responses include that same ID. The success bodies retain their small endpoint-specific shape; there is no global success envelope.

Illustrative response with a fictitious request ID:

```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "Invalid JSON body",
    "requestId": "00000000-0000-4000-8000-000000000001"
  }
}
```

| Status | Code | Trigger |
| --- | --- | --- |
| 400 | `INVALID_JSON` | JSON parser reports malformed JSON |
| 400 | `INVALID_REQUEST` | Parser reports aborted request or invalid request size |
| 413 | `BODY_TOO_LARGE` | JSON body exceeds configured 100 KB limit |
| 415 | `UNSUPPORTED_ENCODING` | Unsupported charset or content encoding |
| 404 | `NOT_FOUND` | No route matches after middleware |
| 500 | `INTERNAL_ERROR` | Unhandled application error; generic response |

An aborted connection may prevent the client from receiving the mapped response. The handler cannot guarantee delivery after the client disconnects. Unexpected errors after headers are sent are delegated to Express.

## Browser access and input handling

`CORS_ORIGINS` allows exact configured origins. Allowed origins receive `Access-Control-Allow-Credentials: true`. Allowed preflights advertise GET, POST, PUT, PATCH, DELETE and OPTIONS and the headers Content-Type, Authorization and X-CSRF-Token. Advertising a header does not implement authentication or CSRF protection.

Unlisted origins receive no CORS permission. This does not block a direct HTTP client or authorize business operations. Request IDs are not explicitly exposed through `Access-Control-Expose-Headers`; a cross-origin browser should not assume it can read that response header.

JSON parsing runs before the routes and fallback 404, so malformed JSON can produce a parser error even for an unknown path. Non-JSON payloads do not acquire a validated application schema simply by reaching Express.

## Logging and compatibility

Finished requests log event, request ID, method, status and duration. They omit paths, queries, headers and bodies. Internal-error logging currently records the event and request ID only. Use the ID for support correlation; do not ask clients to submit tokens or private request payloads.

The `/api/v1` prefix is the existing compatibility boundary. Before business endpoints land, choose an authoritative machine-readable schema source and validate examples against it. Update consumers and examples alongside contract changes, accounting for native clients that may remain installed on older versions. Do not promise generated documentation before generation actually runs.
