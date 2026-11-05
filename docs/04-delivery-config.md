# 04 – Delivery Configuration: Fees, Surcharges, Hours, ETA

Status: draft v1 · Depends on: `PLAN.md`, `02-workflows.md`, `03-erd.md`

All amounts below are **placeholders** to show how the rules work. Real numbers are entered by the admin in settings/rules (no deploy). Money is integer paise in the DB; rupees shown here for readability.

## 1. Where configuration lives

| What | Where | Scope | Edited with |
|---|---|---|---|
| Delivery fee tiers, always-free flag, min order | `delivery_rules` | Per zone | `delivery_rules:manage` |
| Rain mode, late-night fee, other surcharges | `delivery_rules` (type `surcharge`) | Per zone (or list of zones) | `delivery_rules:manage`; rain toggle also `ops_mode:manage` |
| Small-order fee, handling fee, surcharge cap | `settings` | global → zone | `settings:manage` |
| Opening hours, after-hours mode, pre-order windows | `warehouses` | Per warehouse | `warehouses:manage` |
| Pack time, rider-arrival time ("grace time") | `warehouses` (falls back to settings) | Per warehouse | `warehouses:manage` |
| Default travel minutes, locality overrides | `warehouses`, `localities` | Per warehouse / locality | `warehouses:manage` |
| Same-price rule in a zone | `settings` `zonePriceConflictMode` | Global | `settings:manage` |

**Settings resolution:** warehouse value → zone value → global value → code default.

## 2. Delivery fee rules (per zone)

One active `delivery_fee` rule per zone:

```json
{
  "zoneId": "Z-B", "type": "delivery_fee", "isActive": true,
  "alwaysFree": false,
  "minOrder": 10000,
  "feeBasis": "afterDiscount",
  "tiers": [
    { "from": 0,     "to": 29999, "fee": 4000 },
    { "from": 30000, "to": 59999, "fee": 2000 },
    { "from": 60000, "to": null,  "fee": 0    }
  ]
}
```

- `alwaysFree = true` (e.g. the area right next to the warehouse): fee is 0 regardless of amount.
- `feeBasis`: `afterDiscount` (default; tier chosen on subtotal after coupon discount) or `beforeDiscount`.
- Tiers must cover 0..∞ without gaps (validated on save). Min order is checked before fee calculation.
- The cart shows "Add ₹X more for FREE delivery" from the next cheaper tier.

## 3. Surcharges

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
| `rain` | **Manual switch** with `activeUntil` (auto turns off) | Floor staff can flip it with `ops_mode:manage`. Weather data may be used only as a reminder to staff, never to auto-charge. |
| `late_night` | Time window in **IST**, may cross midnight | Evaluate in `Asia/Kolkata`, not UTC |
| `other` | Manual, same shape | e.g. festival/road-closure charge |

- `waivedByFreeDelivery` (default `false`): when true the surcharge is waived if the delivery fee is 0.
- **Surcharge cap** (`surchargeCap`, global/zone): total of all surcharges never exceeds the cap.
- Every change is audited; the panel has a **fee preview** (zone + amount + time → full bill) before saving.
- Customers see rain/night charges as separate labelled lines and a notice on the home screen while active.

## 4. Bill calculation order (server `pricing` module)

1. Items subtotal (sum of current offering prices of the **zone catalog**, one price per product).
2. Coupon/offer discount (min order, caps, per-user, first-order, `free_delivery` type).
3. Zone **delivery fee** from tiers (or 0 if `alwaysFree` / `free_delivery` coupon).
4. Small-order fee, handling fee (settings).
5. Surcharges active at quote time (rain, late-night, other), waiver rules, then cap.
6. GST (per product; treatment of fees/surcharges per CA), inclusive/exclusive per settings.
7. Output `charges[]` = `{ type, label, amount, ruleId }` and `total`.

**Lock rules**
- A **quote** stores the bill and ETA for ~5 minutes (`quotes.expiresAt`). `POST /orders` needs `quoteId`.
- If a price/fee/surcharge changed since the quote → `409 QUOTE_CHANGED` with the new quote; the app shows the difference and asks the customer to accept.
- After placement the delivery fee and surcharges **never increase**. If an unavailable item pushes the order below a free-delivery tier, the fee stays as charged.

### Worked examples (placeholder numbers)

| Order | Zone | Conditions | Delivery fee | Surcharges | Extra time |
|---|---|---|---|---|---|
| ₹250 | A (always free) | Clear, afternoon | ₹0 | – | – |
| ₹350 | B | Rain ON, 3 PM | ₹20 | Rain ₹15 | +10 min |
| ₹700 | B | Rain ON, 11 PM | ₹0 | Rain ₹15 + Night ₹20 = ₹35 | +15 min |

### Split orders (one bill)
For a group that splits across warehouses, all of the above is computed **once on the whole cart**. The group stores `pricing.charges[]`. For refunds/invoices each child gets a pro-rata share by `itemsSubtotal` (rounding remainder to the first child), stored as `allocatedDiscount`, `allocatedCharges[]`, `amountDue`. Delivery fee and surcharges are refunded only if the **whole group** is cancelled before dispatch.

## 5. Hours, after-hours, pre-orders

Per warehouse:

```json
{ "hours": [{ "days": [0,1,2,3,4,5,6], "open": "07:00", "close": "20:00" }],
  "lastOrderMinutesBeforeClose": 15,
  "afterHoursMode": "pre_order",
  "preOrder": { "enabled": true,
    "slots": [{ "start": "07:00", "end": "09:00", "capacity": 20 },
              { "start": "09:00", "end": "11:00", "capacity": 20 }],
    "cutoffMinutesBeforeSlot": 60 } }
```

| `afterHoursMode` | Behaviour outside hours |
|---|---|
| `closed` | Browsing allowed, checkout blocked with reopening time |
| `pre_order` | Checkout allowed for next-morning slot(s); stock reserved at placement; capacity per slot enforced |

- **Late-night delivery** is not a mode: extend `hours` past the usual close and add a `late_night` surcharge window.
- A zone accepts orders now if **any** of its warehouses is open and not paused. Allocation only uses open warehouses.
- `ops_mode:manage` includes a **pause orders** switch per warehouse/zone (e.g. landslide, strike) with message and optional end time.
- Pre-orders are priced at placement time with a fixed quote; surcharges for the **delivery** time window are not re-applied (documented to the customer at checkout). Cancel allowed until slot cutoff.

## 6. ETA

```
promisedMinutes = packMinutes + riderArrivalMinutes + travelMinutes + extraMinutes(rain, night) [+ busyBuffer]
promisedAt      = placedAt + promisedMinutes
```

| Part | Source | Default / note |
|---|---|---|
| `packMinutes` | warehouse setting ("grace time" part 1) | placeholder 5 |
| `riderArrivalMinutes` | warehouse setting ("grace time" part 2) | placeholder 5 |
| `travelMinutes` | Google Routes warehouse → address, **cached per (addressId, warehouseId)**; fallback `localities.travelMinutes` then `warehouse.defaultTravelMinutes` | Hill roads: never use straight-line |
| `extraMinutes` | active surcharges (rain, night) | |
| `busyBuffer` | optional: + minutes when open orders per free rider exceed a threshold | setting, off by default |

**Where shown**
| Screen | Shown | Basis |
|---|---|---|
| Home header (zone known) | Range, e.g. "20–30 min" | Best open warehouse in zone, using locality default |
| Product/cart | Same range | Allocated warehouse(s) |
| Checkout quote | "Arriving by 4:35 PM" and saved as `promisedAt` | Exact allocation |
| Out for delivery | Live ETA from Routes every ~60 s or on status change | Rider position → address; stops before this one added for batches |

- **Split orders:** each child order has its own ETA; the group shows the latest.
- **Batches:** ETA for stop N = ETA to stop N-1 + leg between them + handover time.
- **Capacity guard:** `maxOpenOrdersPerRider` × online riders caps simultaneous orders. When exceeded, the ETA grows by `busyBuffer` or the zone shows "Busy – longer delivery time" (or pauses if the admin chooses).
- Show ranges, not promises: tune warehouse timers from real data (report: promised vs actual by warehouse and hour).
- Tracking shows `lastLocationAt` ("Updated 1 min ago"); location is visible only after pickup.

## 7. Settings registry (initial keys)

| Group | Key | Scope | Placeholder default |
|---|---|---|---|
| delivery | `smallOrderFee`, `smallOrderThreshold` | zone | 0 / 0 (off) |
| delivery | `handlingFee` | zone | 0 |
| delivery | `surchargeCap` | zone | ₹40 |
| delivery | `feeBasis` | zone | `afterDiscount` |
| eta | `packMinutes`, `riderArrivalMinutes` | warehouse | 5 / 5 |
| eta | `defaultTravelMinutes` | warehouse | 10 |
| eta | `busyBufferMinutes`, `busyThreshold` | zone | off |
| eta | `quoteValiditySeconds` | global | 300 |
| hours | `afterHoursMode`, `lastOrderMinutesBeforeClose` | warehouse | `closed` / 15 |
| preOrder | `enabled`, `slots`, `cutoffMinutesBeforeSlot` | warehouse | off |
| assignment | `assignmentMode` (`manual`/`auto`), `ackTimeoutSeconds`, `maxActiveOrders` | zone | `manual` / 120 / 2 |
| assignment | `punchInRadiusMeters` | warehouse | 150 |
| payments | `codEnabled`, `codMaxAmount`, `onlineEnabled`, `onlineOrderExpiryMinutes` | zone | on / ₹2000 / on / 15 |
| payments | `payLinkForCodEnabled` | global | on |
| stock | `zonePriceConflictMode` (`block`/`warn`), `maxQtyPerItem`, `lowStockThreshold` | global | `block` / 10 / 5 |
| orders | `maxSplitsPerOrder` | global | 2 |
| orders | `customerCancelUntil` | global | `CONFIRMED` |
| auth | `loginOtpLength`, `deliveryOtpLength`, `otpMaxPerHour`, `deliveryOtpEnabled` | global | 6 / 4 / 5 / on |
| app | `minAppVersion`, `maintenanceMode`, `supportNumber` | global | – |
| notifications | `abandonedCartMinutes`, `ownerDigestTime` | global | 30 / 20:00 |
| eta | `maxOpenOrdersPerRider` (capacity guard, §6) | zone | 2 |
| preOrder | `packLeadMinutes` (when a pre-order enters the packing list before its slot) | warehouse | 45 |
| orders | `orderConfirmMode` (`auto`/`manual`) | warehouse | `auto` |
| orders | `slaMinutes` per state (delay alert) | zone | placeholder: confirm 5, pack 15, assign 5 |
| orders | `maxItemsPerOrder` | global | 40 |
| payments | `refundWindowHours`, `refundPhotoRequired`, `refundEligibleCategories` | global | 24 / on / perishables |
| stock | `reservationTimeoutMinutes` (same as online expiry) | global | = `onlineOrderExpiryMinutes` |
| assignment | `deliveryGeofenceMeters` (offline-delivery GPS check, flag only) | zone | 300 |
| media | `orderMediaRetentionDays` (voice note + house photo copies), `evidenceRetentionDays`, `maxImageMB`, `maxVoiceSeconds`, `maxVoiceKB` | global | **7** / 90 / 5 / 10 / 500 |
