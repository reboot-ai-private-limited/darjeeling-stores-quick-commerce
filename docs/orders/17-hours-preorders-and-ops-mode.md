# F17 – Hours, Pre-orders & Ops Mode

Status: draft v3 · Folder: orders · Depends on: F03, F11 · See also: F10 (checkout), F13 (placement), F20 (extra minutes)

## 1. Purpose
Decide when a warehouse accepts orders, what happens when it is closed (block or next-morning pre-order), and let floor staff pause orders or switch rain mode quickly.

## 2. Hours and after-hours

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
| `closed` | Browsing allowed, checkout blocked with the reopening time |
| `pre_order` | Checkout allowed for next-morning slots; stock reserved at placement; capacity per slot enforced |

- **Late-night delivery** is not a mode: extend `hours` past the usual close and add a `late_night` surcharge window (F11).
- A zone **accepts orders now** if any of its warehouses is open and not paused. Allocation only uses open warehouses (F13).

## 3. Pre-order flow

1. Closed + `pre_order` → checkout offers the next windows with remaining capacity ("Tomorrow 7–9 AM").
2. Allocation uses the stock of warehouses opening for that slot. Stock is reserved at placement; capacity is enforced atomically.
3. A pre-order is a normal order with `scheduledWindow`. It stays `CONFIRMED`; at `slotStart − packLeadMinutes` the system puts it on the packing list. Dispatch happens inside the window.
4. Online payment is taken at order time. Cancel is allowed until the slot cutoff.
5. Pre-orders are priced at placement with a fixed quote; surcharges for the **delivery** time window are not re-applied (told to the customer at checkout).
6. Rain or pause at slot time can still delay; the admin informs customers from the dispatch board.

## 4. Ops mode (floor-staff switches)

`ops_mode:manage` allows, without full settings access:
- **Rain mode** on/off with an end time (F11).
- **Pause orders** per warehouse or zone with a message and optional end time (landslide, strike, road block).
- Paused → browsing allowed, checkout blocked with the message.

Every use is audited 🔒. A background job turns rain mode off at `activeUntil`.

## 5. Screens
- **Customer:** closed banner with reopening time · pre-order slot picker (day, window, remaining capacity) · paused message.
- **Admin:** warehouse hours editor · pre-order slot editor · ops switches (rain, pause) · pre-order list for the next morning.

## 6. API
Full request and response reference with examples: [API · F17](../api/F17-hours-preorders-and-ops-mode.md).

`GET /store/status?zoneId=` (open, paused, pre-order windows) · `GET /preorder/slots?zoneId=` · admin `PUT /admin/warehouses/:id/hours` · `POST /admin/ops/pause` · `POST /admin/ops/rain`.

## 7. Data
Fields on `warehouses`: `hours`, `lastOrderMinutesBeforeClose`, `afterHoursMode`, `preOrder`, `pause` (owner: F03). `orders.scheduledWindow` (F13). `zones.pause` (F03).

## 8. Settings

| Key | Scope | Placeholder |
|---|---|---|
| `afterHoursMode`, `lastOrderMinutesBeforeClose` | warehouse | `closed` / 15 |
| `preOrder.enabled`, `slots`, `cutoffMinutesBeforeSlot` | warehouse | off |
| `packLeadMinutes` | warehouse | 45 |

## 9. Permissions
`warehouses:manage`, `ops_mode:manage` (🔒), customer `store:view_status` (guest), `order:place_preorder`.

## 10. Open questions
1. Real opening hours, last-order time and morning slots.
2. Capacity per slot (riders and packers available in the morning).
