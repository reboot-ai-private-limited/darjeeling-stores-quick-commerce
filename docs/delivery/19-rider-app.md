# F19 – Rider App (Android)

Status: draft v3 · Folder: delivery · Depends on: F01, F18 · See also: F20 (location and ETA), F21 (offline), F22 (cash), F15 (collection)

## 1. Purpose
The in-house rider's tool for the whole shift: punch in, receive orders, pick up, navigate, deliver, collect payment, see cash in hand. Android only.

## 2. Flow

1. **Start shift:** choose the current warehouse; punch in (geo-tagged, must be within `punchInRadiusMeters` of it; outside is allowed but flagged for admin). Blocked if deactivated.
2. The rider may **switch warehouse** mid-shift; the admin can override.
3. **Assignment alarm:** a loud full-screen alarm (FCM high-priority + Notifee) until the rider acknowledges. **No reject button** (F18). A "Report a problem" action alerts the admin.
4. **Pickup checklist** at the warehouse: verify items and bag count → **Picked up** (`PICKED_UP`). The offline bundle downloads here (F21).
5. When all pickups of the batch are done → **Start ride** (`OUT_FOR_DELIVERY`). For a single stop, one button does both.
6. **Navigate:** in-app map pin, one-tap **Open in Google Maps**, customer landmark text, voice note player, one-tap phone/WhatsApp call.
7. **Arrived** (`ARRIVED`) → the customer is notified.
8. **Doorstep:** customer shows the 4-digit OTP; the rider enters it (works offline, F21). Prepaid → **Delivered**. COD → show the exact `amountDue`, then **Cash collected** or **UPI QR** (F15, F22) → **Delivered**.
9. **Failed delivery** with reason and photo (F18).
10. **End shift:** blocked with active orders or an unsynced outbox (admin can override); closes the shift row (attendance hours).

## 3. Rules

| Rule | Detail |
|---|---|
| Location pings | ~10 s while on an order, ~60 s when idle online; offline pings are buffered (F20, F21) |
| Offline pings sweep | No ping for N minutes while online → marked offline, admin alerted if on an order |
| Break | Not assigned orders while on break |
| Salaried | No payout logic; only shifts, cash ledger and delivery counts |
| Alarm permissions | Full-screen-intent permission (Android 14+), battery-optimisation exclusion, max-importance channel; checked at onboarding and each shift start |
| Distribution | The full-screen alarm permission may be restricted on Google Play, so plan direct APK distribution to the 6 riders |
| Already paid | Red "Already paid – do not collect" when the server marks the group paid (F15) |
| Privacy | The rider sees only their own orders and customers they are assigned to |

## 4. Screens (about 19 screens, about 15 for a first release)
Splash/update check · phone · OTP · permission setup · start shift (warehouse + punch-in) · home dashboard (today's orders, cash, pending sync) · assignment alarm · my orders / batch list · order detail (items, landmark, voice note, call) · pickup checklist · stop list and map · arrived and OTP entry · payment (cash / UPI QR) · delivered confirmation · failed delivery form · report a problem · cash in hand and ledger · delivery history · profile · sync status.

## 5. API (`/api/v1/rider`)
`POST /shift/start` · `/shift/switch-warehouse` · `/shift/break` · `/shift/end` · `GET /assignments?since=` (polled every ~15 s in foreground) · `POST /assignments/:id/ack` · `POST /orders/:id/pickup` · `/start-ride` · `/arrived` · `/deliver` · `/failed` · `/problem` · `POST /sync` (offline events, F21) · `POST /location` · `GET /cash` · `GET /history`.

## 6. Data

**riders**

| Field | Type | Notes |
|---|---|---|
| userId | ref unique | |
| zoneId | ref | **One zone** |
| warehouseIds | ref[] | Warehouses (in that zone) the rider may serve |
| currentWarehouseId | ref? | Chosen at shift start |
| photoMediaId, vehicle | | |
| status | enum | `offline, online, on_break, deactivated` |
| activeOrderCount | int | Maintained by assignment and delivery services |
| lastLocation (Point), lastLocationAt, lastAssignedAt | | |
| currentShiftId | ref? | |
| appVersion, pendingSyncCount | | Reported by the app |

Indexes: `userId` unique, `(zoneId, status, activeOrderCount)`.

**rider_shifts**: `riderId`, `warehouseId`, `startedAt`, `endedAt?`, `punchIn {location, distanceFromWarehouseM, verified}`, `breaks[{from,to}]`, `endedBy` (`rider/admin/system`). Index `(riderId, startedAt)`.

## 7. Settings
`punchInRadiusMeters` (150) · `ackTimeoutSeconds` (120) · `maxActiveOrders` (2) · `deliveryOtpEnabled` (on).

## 8. Permissions
`rider_shift:start`, `rider_shift:switch_warehouse`, `rider_shift:break`, `rider_shift:end`, `rider_assignment:list`, `rider_assignment:acknowledge`, `rider_order:view`, `:navigate`, `:call_customer`, `:pickup`, `:start_ride`, `:arrived`, `:verify_delivery_otp`, `:collect_cash`, `:generate_upi_qr`, `:deliver`, `:report_failed`, `:report_problem`, `rider_sync:push`, `rider_location:update`, `rider_cash:view`, `rider_history:view`, `rider_profile:view`, `rider_profile:update_photo`, `media:upload`.

## 9. Open questions
1. A rider cash-in-hand limit that blocks new assignments? Default none.
2. Rider ordering as a customer on the same phone (F01).
