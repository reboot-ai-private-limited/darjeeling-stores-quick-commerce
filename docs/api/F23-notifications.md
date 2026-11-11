# API · F23 Notifications

Spec: [F23](../platform/23-notifications.md) · Conventions: [00](00-conventions.md)

Customers and riders get push (FCM) and WhatsApp messages sent by the server when events happen. The apps register their FCM token with `POST /devices` ([F01](F01-authentication.md)). This file lists the user preferences, the admin template tools, the webhooks, and **the push payloads the apps must handle**.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/me/notification-prefs` | Customer | My promo preferences |
| `PUT` | `/me/notification-prefs` | Customer | Change promo preferences |
| `GET` | `/admin/notifications` | Admin `notifications:manage` | Delivery log |
| `POST` | `/admin/notifications/:id/retry` | Admin `notifications:manage` | Retry a failed message |
| `POST` | `/admin/broadcast` | Admin `notifications:manage` | Send a promo broadcast |
| `GET` | `/webhooks/whatsapp` | Webhook | Provider verification challenge |
| `POST` | `/webhooks/whatsapp` | Webhook | Delivery status and incoming replies |

## GET /me/notification-prefs · PUT /me/notification-prefs
Order updates and OTPs are always on; only promos and reminders can be switched. Body (all optional):
```json
{ "promoPush": true, "promoWhatsApp": false, "cartReminders": false }
```
200: `{ "data": { "promoPush": true, "promoWhatsApp": false, "cartReminders": false } }`. Abandoned-cart nudges and promo WhatsApp messages are only sent to customers who opted in. A customer who never saved a choice has the values shown (promo push on, the other two off). `PUT` changes only the fields sent, returns all three, and rejects any other field with `400 VALIDATION_ERROR`. Promos are never sent by SMS. Cart reminders, once opted in, go on every channel the template exists for.

## Push payloads the apps handle
Push arrives as an FCM **data** message (so the app can wake and react) with an optional notification title and body.

```json
{
  "type": "order_status",
  "orderId": "ord_1",
  "groupId": "grp_1",
  "orderNo": "DS-240001-A",
  "status": "OUT_FOR_DELIVERY",
  "deepLink": "ds://order/ord_1"
}
```

| `type` | Sent to | Extra fields | What the app does |
|---|---|---|---|
| `order_status` | Customer | `orderId`, `groupId`, `status` | Update the order; open order detail on tap |
| `order_unavailable_item` | Customer | `orderId`, `itemName` | Show "item adjusted", open order |
| `refund_update` | Customer | `refundId`, `status` | Open order detail |
| `back_in_stock` | Customer | `productId`, `zoneId` | Open `ds://product/<productId>` |
| `promo` | Customer (opt-in) | `deepLink` | Open the link |
| `assignment` | Rider | `assignmentId`, `ackDeadlineAt` | **Raise the full-screen alarm** (high priority); open `dsr://assignment/<id>` |
| `assignment_cancelled` | Rider | `assignmentId`, `orderId` | Remove from the list |
| `payment_paid` | Rider | `orderId` | Show **"Already paid – do not collect"** |
| `handover` | Rider | `assignmentId`, `orderId` | Open the handover screen |
| `app_update` | Both | `minVersion` | Prompt to update |

Deep links: customer `ds://order/<id>`, `ds://product/<id>`, `ds://category/<id>`, `ds://cart`; rider `dsr://assignment/<id>`, `dsr://order/<id>`. Do not rely on push alone: apps also poll (F13, F19) and refresh on open.

## Message wording (built in)
There is no template screen or API. Every message the server sends on its own is written in code, in `apps/api/src/modules/notifications/domain/templates.ts`: customer order and refund updates, item-unavailable and cancellation notices, rider assignment, hand-over, cancellation and already-paid alerts, back-in-stock, login codes (WhatsApp, then SMS) and the promo broadcast. Each entry is one message key on one channel (`push`, `whatsapp` or `sms`) with its title, body and category; `{{variables}}` are filled in by the server (`name`, `orderNo`, `total`, `otp`, `trackingUrl`, `riderName`, `riderPhone`, `productName`, `variantLabel`, `itemName`, `amount`, `refundStatus`, `status`, `code`, `minVersion`, `link`, `reason`, `eta`, `title`, `body`). A unit test checks every built-in message uses only those variables and that every WhatsApp message names its provider-approved template.

To change wording, edit that file and deploy. A WhatsApp message must keep matching the template approved by the provider, so a new WhatsApp wording needs the provider's approval first. Push wording can change freely.

## GET /admin/notifications
Query: `status=queued|sent|delivered|failed`, `channel`, `userId`, `orderId`, `from`, `to`, `limit` (default 50, at most 100), `cursor`. Newest first; `nextCursor` is the last id of the page. `failedCount` counts failed messages matching the other filters. Login codes appear with `userId: null`, a masked number in place of the recipient and no text: the code itself is never stored. 200:
```json
{
  "data": [{ "id": "ntf_1", "userId": "user_1", "templateKey": "order_confirmed", "channel": "whatsapp", "status": "failed", "error": "Template not approved", "attempts": 3, "orderId": "ord_1", "createdAt": "2026-11-05T10:30:01Z", "sentAt": null }],
  "meta": { "nextCursor": null, "failedCount": 1 }
}
```

## POST /admin/notifications/:id/retry
200: `{ "data": { "id": "ntf_1", "status": "queued" } }`. The message is sent again with its tries counted from zero. Errors: `409 CONFLICT` with `details.reason = "not_failed"` · `404 NOT_FOUND`.

## POST /admin/broadcast
Promo push to opted-in customers. Body:
```json
{ "zoneIds": ["zone_1"], "title": "Fresh mountain veggies", "body": "Free delivery above ₹399 today", "deepLink": "ds://category/cat_1", "channels": ["push"] }
```
202: `{ "data": { "jobId": "job_9", "recipients": 412 } }`. `recipients` is the number of opted-in customers in those zones (counted up to 50,000); sending happens in the background. `zoneIds` has 1 to 50 ids; `deepLink` is optional and must look like `ds://category/<id>`; `channels` defaults to `["push"]`. WhatsApp marketing needs an active **marketing** template with the key `promo_broadcast` on the WhatsApp channel, whose `{{title}}` and `{{body}}` are filled from the request; without one the call is `400 VALIDATION_ERROR` (`details.field = "channels"`). Only customers who opted in to the channel get it. Repeating the job never sends anyone twice. Audited.

## Webhooks (provider → server)
- `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → echoes `hub.challenge` as plain text when the token matches `WHATSAPP_VERIFY_TOKEN`; otherwise `403`.
- `POST /webhooks/whatsapp` carries message status updates (`sent`, `delivered`, `read`, `failed`) and incoming replies. Verified by the `X-Hub-Signature-256` header (HMAC-SHA256 of the exact request body with `WHATSAPP_APP_SECRET`); updates `notifications.status`. A call that is not correctly signed is answered `200` and ignored. A status only moves a message forward: `read` counts as `delivered`, and a late `sent` never undoes `delivered`. Incoming customer replies are ignored for now. A body that is not valid JSON is refused with `400` by the JSON parser before it reaches this route.

## Also sent by the server (no endpoint)
Login OTP (WhatsApp first, SMS fallback), the 8 PM owner digest, unacknowledged-assignment WhatsApp to the rider, abandoned-cart nudge (opt-in), back-in-stock alerts, and low-stock and payment alerts to admins. See the matrix in [F23](../platform/23-notifications.md).

## Implementation notes (backend, D2-2)

- **Two modules.** `jobs` is a durable work queue in MongoDB (`jobs`, `job_schedules`); `notifications` holds the built-in message wording, the delivery log, preferences, the channel adapters and the webhook. Other modules do not send messages themselves: they call `notifications.notify({ userId, templateKey, vars, data, channels, purpose, dedupeKey })` and the message is queued, sent by a worker, and logged.
- **Queue behavior.** A worker takes a job with one atomic update and holds it for 5 minutes, so two workers never run the same job. If a worker dies, another takes the job over once the hold ends, so a job can run twice and handlers must be safe to repeat (messages are sent only if still `queued` and not held). A failing job is retried after 30 s, 1 min, 2 min... up to an hour, then marked `failed`. A job a worker keeps dying on stops after its tries are used up. Finished jobs are removed after 14 days. `dedupeKey` makes enqueuing the same work twice a no-op.
- **Sending.** One message per channel is saved and a `notification.send` job is queued (5 tries). Push goes to every registered device; devices the provider says are gone are removed; the message counts as sent if any device got it. A failure that waiting cannot fix (no device, no phone, unapproved WhatsApp template, provider not configured) is recorded at once and not retried; anything else (provider busy or down) keeps the message `queued` and retries, then fails with "Gave up after 5 tries". An admin can retry a failed message.
- **Recurring work** (`startBackground()`, once per server start): every minute, give back stock held by an order that never finished (F05 `releaseExpiredHolds`); every minute, hand "item is back" messages from Notify Me to delivery (F07); every hour, delete expired and stuck media (F24 `sweep`). Several servers can run this: each interval runs once.
- **Back in stock.** When a restock makes an item available in a zone, Notify Me records the message and it is handed to delivery straight away, and again every minute as a safety net. The message is the `back_in_stock` template: push with the product picture (320 px) and `ds://product/<id>`, and WhatsApp.
- **Login codes.** `notifications.otp.send(phone, code)` sends the code by WhatsApp (with the copy-code button) and falls back to SMS, answering at once because the person is waiting. It fails with `502 OTP_DELIVERY_FAILED` only when both fail. Dev 1's login calls it in place of the mock.
- **Configuration** (environment variables, never committed): `FCM_SERVICE_ACCOUNT_JSON` (the Firebase service account JSON) or `FCM_SERVICE_ACCOUNT_FILE`; `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, optional `WHATSAPP_API_VERSION`; `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` for the webhook. A provider without settings is "not configured": its messages fail with that reason in the log and can be retried once it is set up.
- **Still needed from others.** The server must call `startBackground()` after the database connects (and `stop()` on shutdown); until then no job runs. The identity module must supply `contacts` (phone per user), `devices` (push tokens, via `POST /devices` in F01) and the geography/addresses modules `audience` (customers per zone); without them nobody has a phone, a device or a zone. Customer and staff login must be connected to the routes (they answer 401 until then).
- **Known shortcuts.** No SMS vendor is chosen, so SMS is "not configured" (the adapter interface exists). Events from other features (order updates, refunds, assignment alarms, owner digest, abandoned cart, low-stock and payment alerts) are not wired: those features do not exist yet, and each will call `notify`. Quiet hours and a limit on how fast messages are sent are not implemented. A broadcast runs as one job and holds its place for 5 minutes, which is enough for tens of thousands of customers but not millions. WhatsApp replies from customers are ignored.
