# API · F23 Notifications

Spec: [F23](../platform/23-notifications.md) · Conventions: [00](00-conventions.md)

Customers and riders get push (FCM) and WhatsApp messages sent by the server when events happen. The apps register their FCM token with `POST /devices` ([F01](F01-authentication.md)). This file lists the user preferences, the admin template tools, the webhooks, and **the push payloads the apps must handle**.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/me/notification-prefs` | Customer | My promo preferences |
| `PUT` | `/me/notification-prefs` | Customer | Change promo preferences |
| `GET` | `/admin/notification-templates` | Admin `notifications:manage` | List templates |
| `POST` | `/admin/notification-templates` | Admin `notifications:manage` | Create a template 🔒 |
| `PUT` | `/admin/notification-templates/:id` | Admin `notifications:manage` | Edit a template 🔒 |
| `GET` | `/admin/notifications` | Admin `notifications:manage` | Delivery log |
| `POST` | `/admin/notifications/:id/retry` | Admin `notifications:manage` | Retry a failed message |
| `POST` | `/admin/broadcast` | Admin `notifications:manage` | Send a promo broadcast 🔒 |
| `GET` | `/webhooks/whatsapp` | Webhook | Provider verification challenge |
| `POST` | `/webhooks/whatsapp` | Webhook | Delivery status and incoming replies |

## GET /me/notification-prefs · PUT /me/notification-prefs
Order updates and OTPs are always on; only promos and reminders can be switched. Body (all optional):
```json
{ "promoPush": true, "promoWhatsApp": false, "cartReminders": false }
```
200: `{ "data": { "promoPush": true, "promoWhatsApp": false, "cartReminders": false } }`. Abandoned-cart nudges and promo WhatsApp messages are only sent to customers who opted in.

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

## GET /admin/notification-templates
200:
```json
{
  "data": [
    { "id": "tpl_1", "key": "order_confirmed", "channel": "whatsapp", "title": null, "body": "Hi {{name}}, order {{orderNo}} is confirmed. Total ₹{{total}}. Delivery OTP: {{otp}}. Track: {{trackingUrl}}", "whatsappTemplateName": "order_confirmed_v1", "category": "utility", "language": "en", "isActive": true },
    { "id": "tpl_2", "key": "order_confirmed", "channel": "push", "title": "Order confirmed", "body": "Your order {{orderNo}} is confirmed.", "whatsappTemplateName": null, "category": "utility", "language": "en", "isActive": true }
  ],
  "meta": { "count": 2 }
}
```
`channel`: `push`, `whatsapp`, `sms`. `category`: `utility`, `marketing`, `authentication`. `{{vars}}` are filled by the server. `(key, channel)` is unique.

## POST /admin/notification-templates · PUT /admin/notification-templates/:id
Body: the object without `id`. 201/200: the template. Errors: `409 CONFLICT` (`key` + `channel` exists) · `400 VALIDATION_ERROR` (unknown `{{var}}`). A WhatsApp template must match one approved by the provider; changing `body` does not change the approved text.

## GET /admin/notifications
Query: `status=queued|sent|delivered|failed`, `channel`, `userId`, `orderId`, `from`, `to`, `limit`, `cursor`. 200:
```json
{
  "data": [{ "id": "ntf_1", "userId": "user_1", "templateKey": "order_confirmed", "channel": "whatsapp", "status": "failed", "error": "Template not approved", "attempts": 3, "orderId": "ord_1", "createdAt": "2026-11-05T10:30:01Z", "sentAt": null }],
  "meta": { "nextCursor": null, "failedCount": 1 }
}
```

## POST /admin/notifications/:id/retry
200: `{ "data": { "id": "ntf_1", "status": "queued" } }`. Errors: `409 CONFLICT` (not failed).

## POST /admin/broadcast
Promo push to opted-in customers. Body:
```json
{ "zoneIds": ["zone_1"], "title": "Fresh mountain veggies", "body": "Free delivery above ₹399 today", "deepLink": "ds://category/cat_1", "channels": ["push"] }
```
202: `{ "data": { "jobId": "job_9", "recipients": 412 } }`. WhatsApp marketing needs an approved marketing template and customer opt-in. Audited.

## Webhooks (provider → server)
- `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → echoes `hub.challenge` when the token matches.
- `POST /webhooks/whatsapp` carries message status updates (`sent`, `delivered`, `read`, `failed`) and incoming replies. Verified by signature; updates `notifications.status`. Always answers `200`.

## Also sent by the server (no endpoint)
Login OTP (WhatsApp first, SMS fallback), the 8 PM owner digest, unacknowledged-assignment WhatsApp to the rider, abandoned-cart nudge (opt-in), back-in-stock alerts, and low-stock and payment alerts to admins. See the matrix in [F23](../platform/23-notifications.md).
