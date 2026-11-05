# F11 – Delivery Fees & Surcharges

Status: draft v3 · Folder: customer · Depends on: F03, F25 · See also: F10 (quote), F13 (fee allocation), F17 (hours and ops mode), F20 (extra minutes)

All amounts below are **placeholders** to show how the rules work. Real numbers are entered by the admin in rules and settings, no deploy. Money is integer paise in the DB; rupees here for readability.

## 1. Purpose
Charge delivery by order amount per zone, with free areas, rain mode, late-night fees and small-order fees, all changeable by the admin.

## 2. Where configuration lives

| What | Where | Scope | Edited with |
|---|---|---|---|
| Fee tiers, always-free flag, min order | `delivery_rules` | Per zone | `delivery_rules:manage` |
| Rain, late-night and other surcharges | `delivery_rules` (type `surcharge`) | Per zone or list of zones | `delivery_rules:manage`; rain toggle also `ops_mode:manage` |
| Small-order fee, handling fee, surcharge cap | `settings` | global → zone | `settings:manage` |
| Same-price rule | `settings` | Global | `settings:manage` |

Settings resolution: warehouse → zone → global → code default.

## 3. Delivery fee rule (per zone)

One active `delivery_fee` rule per zone:

```json
{
  "zoneId": "Z-B", "type": "delivery_fee", "isActive": true,
  "alwaysFree": false, "minOrder": 10000, "feeBasis": "afterDiscount",
  "tiers": [
    { "from": 0,     "to": 29999, "fee": 4000 },
    { "from": 30000, "to": 59999, "fee": 2000 },
    { "from": 60000, "to": null,  "fee": 0    }
  ]
}
```

- `alwaysFree = true` (for example the area next to the warehouse): fee is 0 regardless of amount.
- `feeBasis`: `afterDiscount` (default) or `beforeDiscount`.
- Tiers must cover 0 to infinity without gaps (validated on save). Min order is checked before fee calculation.
- The cart shows "Add ₹X more for FREE delivery" from the next cheaper tier.

## 4. Surcharges

```json
{ "zoneIds": ["Z-A","Z-B"], "type": "surcharge", "kind": "rain",
  "isActive": false, "activeUntil": "2026-11-05T18:00:00Z",
  "amount": 1500, "extraMinutes": 10, "waivedByFreeDelivery": false }

{ "zoneIds": ["Z-A","Z-B"], "type": "surcharge", "kind": "late_night",
  "window": { "start": "22:00", "end": "06:00", "tz": "Asia/Kolkata", "days": [0,1,2,3,4,5,6] },
  "amount": 2000, "extraMinutes": 5, "waivedByFreeDelivery": false }
```

| Surcharge | Trigger | Notes |
|---|---|---|
| `rain` | **Manual switch** with `activeUntil` (turns itself off) | Floor staff flip it with `ops_mode:manage`. Weather data may only remind staff, never auto-charge |
| `late_night` | Time window in **IST**, may cross midnight | Evaluated in `Asia/Kolkata`, not UTC |
| `other` | Manual, same shape | For example a festival or road-closure charge |

- `waivedByFreeDelivery` (default false): when true, the surcharge is waived if the delivery fee is 0.
- **Surcharge cap** (`surchargeCap`): total surcharges never exceed it.
- Every change is audited; the admin panel has a **fee preview** (zone + amount + time → full bill) before saving.
- Customers see rain and night charges as separate labelled lines and a notice on the home screen while active.

## 5. Bill calculation order (server `pricing` module)

1. Items subtotal (current offering prices of the zone catalog, one price per product).
2. Coupon/offer discount (F12).
3. Zone **delivery fee** from tiers (0 if `alwaysFree` or a `free_delivery` coupon).
4. Small-order fee, handling fee.
5. Active surcharges (rain, late-night, other), waiver rules, then cap.
6. GST per product; treatment of fees and surcharges per CA; inclusive/exclusive per settings.
7. Output `charges[]` = `{type, label, amount, ruleId}` and `total`.

**Lock rules**
- A quote stores the bill and ETA for ~5 minutes (F10).
- After placement the delivery fee and surcharges **never increase**. If an unavailable item pushes the order below a free-delivery tier, the fee stays as charged (F14).

### Worked examples (placeholder numbers)

| Order | Zone | Conditions | Delivery fee | Surcharges | Extra time |
|---|---|---|---|---|---|
| ₹250 | A (always free) | Clear, afternoon | ₹0 | none | none |
| ₹350 | B | Rain ON, 3 PM | ₹20 | Rain ₹15 | +10 min |
| ₹700 | B | Rain ON, 11 PM | ₹0 | Rain ₹15 + Night ₹20 = ₹35 | +15 min |

## 6. Split orders (one bill)
For a group that splits across warehouses (F13), all of the above is computed **once on the whole cart**. The group stores `pricing.charges[]`. For refunds and invoices each child gets a pro-rata share by `itemsSubtotal` (rounding remainder to the first child): `allocatedDiscount`, `allocatedCharges[]`, `amountDue`. Delivery fee and surcharges are refunded only if the **whole group** is cancelled before dispatch (F16).

## 7. Screens
- **Customer:** fee notice chips on home, free-delivery progress bar and itemised bill in cart, charge lines in checkout.
- **Admin:** delivery rules per zone (tiers editor, always-free toggle), surcharge editor, rain-mode switch, fee preview.

## 8. API
`GET /admin/delivery-rules?zoneId=` · `POST/PUT /admin/delivery-rules` · `POST /admin/delivery-rules/preview {zoneId, subtotal, at}` · `POST /admin/ops/rain {on, until}` · customer pricing is returned inside quotes (F10).

## 9. Data

**delivery_rules**

| Field | Type | Notes |
|---|---|---|
| zoneIds | ref[] | A rule may cover several zones (surcharges) |
| type | enum | `delivery_fee`, `surcharge` |
| kind | enum? | `rain`, `late_night`, `other` |
| isActive, activeUntil | | Rain mode auto-off |
| alwaysFree, minOrder, feeBasis, tiers | | Fee rule |
| window | {start, end, tz, days}? | Night window |
| amount, extraMinutes | int? | Surcharge |
| waivedByFreeDelivery | bool? | |

Index `(type, isActive)`, `zoneIds`. One active `delivery_fee` rule per zone (validated).

## 10. Settings

| Key | Scope | Placeholder |
|---|---|---|
| `smallOrderFee`, `smallOrderThreshold` | zone | 0 / 0 (off) |
| `handlingFee` | zone | 0 |
| `surchargeCap` | zone | ₹40 |
| `feeBasis` | zone | `afterDiscount` |
| `zonePriceConflictMode` | global | `block` |

## 11. Permissions
`delivery_rules:manage` (🔒), `ops_mode:manage` (🔒), `settings:manage`.

## 12. Open questions
1. Does free delivery also remove rain and night fees? Assumed no (`waivedByFreeDelivery` false).
2. GST on delivery fees and surcharges (CA).
