# External integrations

MongoDB is the only external service currently called by application code. The following provider choices describe product direction, not installed SDKs, configured accounts or verified delivery.

| Integration | Current state | Owning design | Required evidence before release |
| --- | --- | --- | --- |
| MongoDB/Mongoose | Connection, readiness and disconnect implemented | [Persistence](data-model.md) | Environment-specific connectivity, access control and restore exercise |
| Razorpay | Proposed | [Payments](../orders/15-payments.md) | Signature checks, duplicated/out-of-order webhook tests, provider sandbox reconciliation |
| WhatsApp and SMS fallback | Proposed | [Notifications](../platform/23-notifications.md), [authentication](../foundation/01-authentication.md) | Approved templates, credentials, actual delivery and timeout/fallback evidence |
| FCM/Notifee | Proposed | [Rider app](../delivery/19-rider-app.md) | Background/locked-screen behavior on intended hardware |
| Google Maps | Proposed | [Tracking and ETA](../delivery/20-eta-and-live-tracking.md) | Restricted keys, quota/billing controls and fallback ETA behavior |
| S3/CloudFront | Proposed | [Media](../platform/24-media-storage.md) | Authorized upload/read, private-object protection and retention cleanup |

## Adapter boundaries

Future application operations should depend on the narrow action they require, such as sending an OTP, rather than a provider SDK. Infrastructure translates provider failures into explicit application outcomes. Keep provider payloads and credential handling out of domain rules and public client contracts.

Define each call's timeout, retry eligibility, idempotency key and ambiguous-success handling before adding automatic retries. Retrying a read differs from retrying a money movement. An HTTP timeout does not prove that the provider performed no action.

## Credentials and verification

Use server runtime secrets for database/provider credentials. Use platform restrictions for any intentionally public map key. Never include real tokens or customer data in examples, fixtures or incident attachments.

A fake adapter proves application branching only. A sandbox call proves a scoped provider interaction only. Neither establishes production credentials, template approval, device permissions or end-to-end operations. Record those separately with environment, action, observed result and safe evidence.
