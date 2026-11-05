# API · F11 Delivery Fees & Surcharges

Spec: [F11](../customer/11-delivery-fees-and-surcharges.md) · Conventions: [00](00-conventions.md)

Customers never call a fee endpoint: they see fees in `GET /store/status` ([F08](F08-discovery-and-location.md)), the cart's free-delivery bar and the quote's `pricing.charges[]` ([F10](F10-cart-and-quote.md)). These endpoints are for the admin panel.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/delivery-rules` | Admin `delivery_rules:manage` | List fee and surcharge rules |
| `POST` | `/admin/delivery-rules` | Admin `delivery_rules:manage` | Create a rule |
| `GET` | `/admin/delivery-rules/:id` | Admin `delivery_rules:manage` | One rule |
| `PUT` | `/admin/delivery-rules/:id` | Admin `delivery_rules:manage` | Edit a rule |
| `DELETE` | `/admin/delivery-rules/:id` | Admin `delivery_rules:manage` | Deactivate a rule |
| `POST` | `/admin/delivery-rules/preview` | Admin `delivery_rules:manage` | Preview a full bill |
| `POST` | `/admin/ops/rain` | Admin `ops_mode:manage` | Switch rain mode (also in [F17](F17-hours-preorders-and-ops-mode.md)) |

All amounts are paise. Every change is audited.

## Object: fee rule (one active per zone)

```json
{
  "id": "rule_1",
  "type": "delivery_fee",
  "zoneIds": ["zone_1"],
  "isActive": true,
  "alwaysFree": false,
  "minOrder": 10000,
  "feeBasis": "afterDiscount",
  "tiers": [
    { "from": 0, "to": 29999, "fee": 4000 },
    { "from": 30000, "to": 59999, "fee": 2000 },
    { "from": 60000, "to": null, "fee": 0 }
  ]
}
```
Tiers must start at 0, have no gaps and end with `"to": null`. `feeBasis`: `afterDiscount` or `beforeDiscount`. `alwaysFree: true` makes the fee 0 regardless of amount (for example the area next to the warehouse).

## Object: surcharge rule

```json
// Rain mode (manual switch with an automatic end)
{ "id": "rule_2", "type": "surcharge", "kind": "rain", "zoneIds": ["zone_1", "zone_2"], "isActive": true,
  "activeUntil": "2026-11-05T18:00:00Z", "amount": 1500, "extraMinutes": 10, "waivedByFreeDelivery": false }

// Late-night window (evaluated in IST, may cross midnight)
{ "id": "rule_3", "type": "surcharge", "kind": "late_night", "zoneIds": ["zone_1"], "isActive": true,
  "window": { "start": "22:00", "end": "06:00", "tz": "Asia/Kolkata", "days": [0, 1, 2, 3, 4, 5, 6] },
  "amount": 2000, "extraMinutes": 5, "waivedByFreeDelivery": false }
```
`kind`: `rain`, `late_night`, `other`. The total of all surcharges is capped by the `surchargeCap` setting.

## GET /admin/delivery-rules
Query: `?zoneId=&type=delivery_fee|surcharge&isActive=true`. 200: `{ "data": [<rule>], "meta": { "count": 3 } }`.

## POST /admin/delivery-rules · PUT /admin/delivery-rules/:id
Body = the rule object without `id` (PUT: only changed fields). 201/200: the rule.

Errors:
- `400 VALIDATION_ERROR` — tiers have a gap, do not start at 0, or `window` is malformed.
- `409 CONFLICT` — the zone already has an active `delivery_fee` rule (`details.ruleId`).
- `403 FORBIDDEN` — zone outside the caller's grant.

## DELETE /admin/delivery-rules/:id
Sets `isActive: false`. 200: `{ "data": { "ok": true } }`. Existing quotes keep their locked values until they expire.

## POST /admin/delivery-rules/preview
Shows exactly what a customer would be charged. Nothing is saved.

Body:
```json
{ "zoneId": "zone_1", "subtotal": 35000, "discount": 0, "at": "2026-11-05T23:00:00+05:30", "splitIntoWarehouses": 1 }
```
200:
```json
{
  "data": {
    "charges": [
      { "type": "delivery_fee", "label": "Delivery fee", "amount": 2000, "ruleId": "rule_1" },
      { "type": "surcharge_rain", "label": "Rain surcharge", "amount": 1500, "ruleId": "rule_2" },
      { "type": "surcharge_late_night", "label": "Late-night fee", "amount": 2000, "ruleId": "rule_3" }
    ],
    "surchargeCapApplied": false,
    "extraMinutes": 15,
    "total": 40500,
    "nextFreeDeliveryAt": 60000
  }
}
```
Use it in the rule editor ("Preview bill") before saving a change.

## POST /admin/ops/rain
Body: `{ "on": true, "until": "2026-11-05T18:00:00Z", "zoneIds": ["zone_1"] }` → 200: `{ "data": { "ruleId": "rule_2", "isActive": true, "activeUntil": "2026-11-05T18:00:00Z" } }`. `on: false` switches it off. A background job also switches it off at `until`.

## What clients see
- Quote line: `{ "type": "surcharge_rain", "label": "Rain surcharge", "amount": 1500 }` inside `pricing.charges[]`.
- Fees never increase after an order is placed, even if an item is later removed ([F14](F14-order-lifecycle-and-packing.md)).
