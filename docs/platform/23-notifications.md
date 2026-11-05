# F23 – Notifications

Status: draft v3 · Folder: platform · Depends on: F01, F13, F14 · See also: F07 (Notify Me), F18 (ack fallback), F25 (templates admin)

## 1. Purpose
Tell customers, riders and admins what is happening, reliably on weak hill networks, by **push (FCM) and WhatsApp**, with SMS as an OTP fallback.

## 2. Channels

| Channel | Used for |
|---|---|
| Push (FCM) | Order status, rider assignment alarm (Notifee full-screen), promos |
| WhatsApp Business API (W-Agent provider) | Login OTP, order confirmation (with delivery OTP and tracking link), out for delivery, receipt/invoice, refunds, back in stock, owner digest, unacknowledged-assignment fallback. Reaches web-only users |
| SMS | OTP fallback only |

## 3. Architecture

- Order state changes **emit events**; a `notification` module listens and enqueues jobs. No ad-hoc sends scattered in code.
- Sends run through the Mongo `jobs` collection with a worker polling every few seconds, with retries, per-user preferences and a **delivery log**.
- Channel adapters: `fcm`, `whatsapp`, `sms`. Templates are admin-editable with `{{vars}}`.
- WhatsApp webhooks: `POST /webhooks/whatsapp` receives delivery status (sent, delivered, read, failed) and incoming replies; statuses update `notifications.status`.
- OTP uses WhatsApp first, SMS fallback (F01).

## 4. Notification matrix

| Event | Customer | Rider | Admin |
|---|---|---|---|
| Login OTP | WhatsApp (SMS fallback) | same | – |
| Order placed / confirmed | Push + WhatsApp (items, bill, **delivery OTP**, tracking link) | – | Bell (polling) + WhatsApp (warehouse admins) |
| Split into 2 deliveries | in the above | – | – |
| Item unavailable / bill changed | Push + WhatsApp | – | – |
| Assigned | Push | **Full-screen alarm**; WhatsApp if not acked in 2 min | Alert if not acked |
| Out for delivery | Push + WhatsApp (rider name and phone, tracking link, pay-online link if COD) | – | – |
| Arrived | Push | – | – |
| Delivered | Push + WhatsApp (receipt PDF) | – | – |
| Offline delivery flagged / OTP mismatch | – | – | Alert |
| Failed delivery | Push | – | Alert |
| Cancelled | Push + WhatsApp | Push if assigned | – |
| Refund created / approved / rejected / done | Push + WhatsApp | – | Pending-refund badge |
| Back in stock (Notify Me) | Push + WhatsApp | – | – |
| Abandoned cart (30 min, opt-in) | Push + WhatsApp (optional) | – | – |
| Payment mismatch / late payment / overpaid | – | – | Alert |
| Low stock / delayed order | – | – | Alert |
| Daily 20:00 digest | – | – | Owner WhatsApp: orders, revenue, per-warehouse split, pending rider cash |
| Promo broadcast | Push (opt-in) | – | – |

Admin new-order alerts also reach a manager by WhatsApp so a closed panel tab does not miss orders.

## 5. WhatsApp setup checklist
Meta Business account verified · WhatsApp Business Cloud API app · dedicated number not active on the WhatsApp app (or migrated) · submit templates in **Phase 1** so they are approved by Phase 2: order confirmed, out for delivery (with tracking link), delivered, refund done, login OTP (authentication), back in stock. Push + SMS cover the gap until approval.

**Categories:** transactional messages are *utility*; abandoned cart and promos are *marketing* and need customer opt-in and an approved marketing template (higher cost). The abandoned-cart nudge is optional.

## 6. Background jobs

| Job | Trigger | Does |
|---|---|---|
| Notification worker | `jobs` queue | Sends push, WhatsApp, SMS with retries |
| Ack sweeper | ~10 s | No rider ack by `ackDeadlineAt` → WhatsApp rider, alert admin (F18) |
| Notify Me trigger | Zone availability 0 → >0 | Push + WhatsApp to subscribers (F07) |
| Abandoned cart | Cart idle 30 min (setting) | Nudge opted-in users |
| Owner digest | Daily 20:00 (setting) | WhatsApp summary to the owner |
| Payment expiry | Every minute | Cancel unpaid online groups (F15) |
| Surcharge expiry | Every minute | Turn rain mode off at `activeUntil` (F11) |
| Low-stock alert | On stock change | Notify admin (F05) |
| Rider offline sweep | Periodic | Mark riders offline on stale ping (F19) |
| Reconciliation | Daily | Razorpay vs DB (F15) |
| Media delete sweep | Hourly | Delete due and stuck media (F24) |
| OTP / session cleanup | TTL indexes | Expire OTPs and tokens |

## 7. Screens (admin)
Templates list and editor (push and WhatsApp text, WhatsApp template name, language) · delivery log (status, error, retry) · broadcast composer.

## 8. API
Full request and response reference with examples: [API · F23](../api/F23-notifications.md).

Admin: `GET/PUT /admin/notification-templates` · `GET /admin/notifications` · `POST /admin/notifications/:id/retry` · `POST /admin/broadcast`. Webhooks: `POST /webhooks/whatsapp`. Customer: `PUT /me/notification-prefs`.

## 9. Data
**notification_templates**: `key`, `channel` (`push, whatsapp, sms`), `title?`, `body` with `{{vars}}`, `whatsappTemplateName?`, `category` (`utility, marketing, authentication`), `language`, `isActive`; unique `(key, channel)`.
**notifications**: `userId`, `templateKey`, `channel`, `payload`, `status` (`queued, sent, delivered, failed`), `providerMessageId?`, `error?`, `attempts`, `orderId?`. Index `(userId, createdAt)`, `(status, createdAt)`.
**jobs**: `type` (`send_notification, expire_payment, ack_sweep, notify_me, owner_digest, abandoned_cart, reconcile, delete_media, …`), `payload`, `runAt`, `status` (`pending, running, done, failed`), `attempts`, `lockedUntil?`, `lastError?`. Index `(status, runAt)`.

## 10. Settings
`abandonedCartMinutes` (30) · `ownerDigestTime` (20:00) · `ackTimeoutSeconds` (120) · channel toggles and quiet hours.

## 11. Permissions
`notifications:manage` (templates 🔒, broadcast 🔒, log, retry); customer `notification_pref:update`.

## 12. Open questions
1. Confirm provider (W-Agent) template categories and cost per message.
2. Quiet hours for promos and abandoned-cart nudges.
