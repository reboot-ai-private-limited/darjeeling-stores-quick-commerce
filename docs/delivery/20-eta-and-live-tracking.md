# F20 – ETA & Live Tracking

Status: draft v3 · Folder: delivery · Depends on: F03, F11, F17, F19 · See also: F10 (quote), F13 (promisedAt), F21 (weak network)

## 1. Purpose
Tell the customer when the order will arrive, honestly, and show the rider on the map once the order is on the road.

## 2. ETA formula

```
promisedMinutes = packMinutes + riderArrivalMinutes + travelMinutes + extraMinutes(rain, night) [+ busyBuffer]
promisedAt      = placedAt + promisedMinutes
```

| Part | Source | Default / note |
|---|---|---|
| `packMinutes` | Warehouse setting ("grace time" part 1) | placeholder 5 |
| `riderArrivalMinutes` | Warehouse setting ("grace time" part 2) | placeholder 5 |
| `travelMinutes` | Google Routes, warehouse → address, **cached per (addressId, warehouseId)**; fallback `localities.travelMinutes`, then `warehouse.defaultTravelMinutes` | Hill roads: never use straight-line distance |
| `extraMinutes` | Active surcharges (rain, night), F11 | |
| `busyBuffer` | Optional extra minutes when open orders per free rider pass a threshold | Off by default |

### Where ETA is shown

| Screen | Shown | Basis |
|---|---|---|
| Home header | Range, e.g. "20–30 min" | Best open warehouse in the zone, locality default |
| Product / cart | Same range | Allocated warehouse or warehouses |
| Checkout quote | "Arriving by 4:35 PM", saved as `promisedAt` | Exact allocation |
| Out for delivery | Live ETA from Routes every ~60 s or on status change | Rider position → address; earlier stops added for batches |

- **Split orders:** each child has its own ETA; the group shows the latest.
- **Batches:** ETA for stop N = ETA to stop N−1 + the leg between them + handover time.
- **Capacity guard:** `maxOpenOrdersPerRider` × online riders caps simultaneous orders. Beyond it the ETA grows by `busyBuffer`, or the zone shows "Busy – longer delivery time", or pauses (admin choice).
- Show **ranges, not promises**; tune warehouse timers from real data (report: promised vs actual by warehouse and hour).
- Google Routes cost control: one call per placed order and address-warehouse pair, plus one per ~60 s while out for delivery (about 750 calls a day, instead of about 9,000 if recalculated on every poll).

## 3. Live tracking

1. Rider posts location every ~10 s on an order, ~60 s when idle online (F19). The backend keeps the latest position on the rider (`lastLocation`).
2. Customer polls `GET /orders/:id/tracking` → `{status, riderLocation?, lastLocationAt, eta, timeline}`: ~10 s while out for delivery, ~30 s before; stops in the background or on a terminal state.
3. The marker animates between points on the client; the UI shows "Updated 1 min ago" instead of a frozen icon.
4. **Privacy:** the rider's location is visible only after pickup and never shows other customers' stops.
5. **Public tracking link:** WhatsApp sends a link with an expiring token (`trackingToken`) so the page works without login.
6. **No sockets.** Push (FCM) covers key status changes when the app is closed.
7. Admin dispatch board polls every ~5 s (F18).

## 4. Screens
- **Customer:** home ETA header · ETA in cart and checkout · tracking map with rider marker, route, ETA pill, "updated X ago", rider call button, delivery OTP card, progress steps, second delivery card for split orders.
- **Admin:** rider map on the dispatch board · promised vs actual report (F25).

## 5. API
`GET /orders/:id/tracking` · `GET /track/:token` (public) · `POST /rider/location` (F19). Quotes carry ETA per child (F10).

## 6. Data
**rider_location_trail** (optional, off at launch): `riderId`, `orderId?`, `point`, `at`, TTL ~7 days.
Fields elsewhere: `orders.etaBreakdown`, `orders.promisedAt` (F13), `riders.lastLocation`, `lastLocationAt` (F19), `warehouses.packMinutes/riderArrivalMinutes/defaultTravelMinutes` (F03), `localities.travelMinutes`.

## 7. Settings

| Key | Scope | Placeholder |
|---|---|---|
| `packMinutes`, `riderArrivalMinutes` | warehouse | 5 / 5 |
| `defaultTravelMinutes` | warehouse | 10 |
| `busyBufferMinutes`, `busyThreshold` | zone | off |
| `maxOpenOrdersPerRider` | zone | 2 |
| `quoteValiditySeconds` | global | 300 |

## 8. Permissions
Customer `order:track`, `rider:call`; admin `dispatch:manage`.

## 9. Open questions
1. Real pack and rider-arrival minutes per warehouse; tune from delivery data after launch.
2. Keep a location trail for disputes and route analysis? Default off.
