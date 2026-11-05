# F07 – Notify Me (Back in Stock)

Status: draft v3 · Folder: catalog · Depends on: F05, F23 · See also: F08

## 1. Purpose
When an item is out of stock, the customer taps **Notify Me**. As soon as it is available again in their zone, they get a push and a WhatsApp message with the product image and a deep link.

## 2. Flow

1. Out-of-stock cards show a **Notify me** button instead of ADD (F08).
2. Tap → a subscription is saved for the customer, zone, product (and variant).
3. When stock in **any warehouse of that zone** goes from 0 to above 0, a job sends push + WhatsApp to every waiting subscriber, then marks the subscription `notified`.
4. The admin sees a **demand list**: how many customers are waiting per product and zone, to guide restocking.

## 3. Rules

| Rule | Detail |
|---|---|
| Scope | Per zone, not per warehouse, because the customer sees the zone's combined catalog |
| One-shot | A subscription closes after one message |
| Unique | One waiting subscription per customer, zone, product, variant |
| Throttle | Messages are queued and rate-limited; failures retry (F23) |
| Opt-in | Customer can cancel the subscription; WhatsApp message uses an approved template |
| Trigger | Zone availability changes from none to some (any open warehouse) |

## 4. Screens
- **Customer:** "Notify me" button on cards and product detail; confirmation toast; list of active notifications (optional).
- **Admin:** Demand list (product, zone, count, oldest request).

## 5. API
`POST /notify-me {productId, variantId?}` · `DELETE /notify-me/:id` · admin `GET /admin/notify-demand`.

## 6. Data

**stock_subscriptions**: `userId`, `zoneId`, `productId`, `variantId?`, `channels` [push, whatsapp], `status` (`waiting, notified, cancelled`), `notifiedAt?`. Unique `(userId, zoneId, productId, variantId)` while `waiting`; index `(zoneId, productId, status)`.

## 7. Settings
`notifyMeThrottlePerMinute` (placeholder).

## 8. Permissions & notifications
Keys: `notify_me:subscribe`, `notify_me:unsubscribe`, admin `notify_demand:view`.
Notification: back-in-stock push and WhatsApp (utility template, F23).

## 9. Open questions
1. Notify only customers whose saved address is in the zone, or any customer who subscribed? Default: subscribed zone.
