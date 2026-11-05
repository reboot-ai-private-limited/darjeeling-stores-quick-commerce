# F03 – Cities, Zones & Warehouses

Status: draft v3 · Folder: foundation · Depends on: F02 · See also: F05 (stock), F08 (zone resolve), F11 (fees), F17 (hours), F19 (riders)

## 1. Purpose
Define where we deliver and where stock lives. The customer's location decides the zone; the zone decides the catalog, prices, fees and ETA.

## 2. Model

```
City (label, locality dropdown)
 └─ Zone (GeoJSON polygon; delivery rules; riders belong to one zone)
     └─ Warehouse 1..N (belongs to exactly ONE zone)
```

- A zone has many warehouses; a warehouse belongs to one zone.
- A rider belongs to one zone and may work from several of that zone's warehouses (F19).
- Zones must not overlap (the map editor rejects overlaps on save).
- **No stock transfers** between warehouses (F06 copies data, not goods).

## 3. Flows

**Create a zone (admin):** draw a polygon on the map → choose city → save → system checks no overlap with another enabled zone → add a delivery fee rule (F11) → add warehouses.

**Add a warehouse (admin):** name, code, zone, map location, address, opening hours, after-hours mode, pre-order slots (F17), pack and rider-arrival minutes (F20), priority, UPI details (F22), punch-in radius.

**Resolve a location (customer):** GPS point or locality → `$geoIntersects` against enabled zones → `zoneId` (F08). No zone → "Coming soon" and waitlist.

**Pause / disable:** a zone or warehouse can be paused with a message and optional end time (F17), or disabled.

## 4. Rules

| Rule | Detail |
|---|---|
| One zone per warehouse | `warehouses.zoneId` is a single value |
| Rider zone | `riders.zoneId` single; `riders.warehouseIds` must all be in that zone |
| Polygon overlap | Rejected on save |
| Locality | Belongs to a city (optional zone link); used for the address dropdown and ETA default |
| Allocation | Only enabled, open warehouses are candidates (F13) |
| Disabling | A warehouse with active orders cannot be disabled until they finish |

## 5. Screens (admin)
Zones map editor · zone list · warehouse list · warehouse editor (hours, slots, timers, priority) · cities and localities.

## 6. API
`POST /location/resolve {lat,lng | localityId}` · `POST /zones/check` · admin: `GET/POST/PUT /admin/cities` · `/admin/localities` · `/admin/zones` · `/admin/warehouses`.

## 7. Data

**cities**: `name`, `state`, `isActive`.
**localities**: `cityId`, `name`, `location` (Point), `zoneId?`, `travelMinutes?`, `isActive`, `sortOrder`.

**zones**

| Field | Type | Notes |
|---|---|---|
| name, cityId | | |
| polygon | GeoJSON Polygon | 2dsphere |
| isEnabled | bool | |
| pause | {active, message, until?}? | |

**warehouses**

| Field | Type | Notes |
|---|---|---|
| name, code, vendorId | | vendorId defaults to owner |
| zoneId | ref | Exactly one zone |
| location | Point | 2dsphere |
| address | embedded | |
| isEnabled, priority | | Lower priority number wins ties |
| hours, lastOrderMinutesBeforeClose, afterHoursMode, preOrder | | F17 |
| packMinutes, riderArrivalMinutes, defaultTravelMinutes | int? | F20 |
| upi | {vpa, payeeName}? | Business VPA, audited (F22) |
| pause | {active, message, until?}? | |
| punchInRadiusMeters | int? | F19 |

Indexes: `zoneId`; `location` 2dsphere; zones `polygon` 2dsphere.

## 8. Settings
`punchInRadiusMeters` (warehouse) · hours and timers live on the warehouse record.

## 9. Permissions
`zones:manage`, `warehouses:view`, `warehouses:manage`, `ops_mode:manage`; customer `location:resolve_zone` (guest), `zone:check`.

## 10. Open questions
1. Should localities be per zone instead of per city once zones exist? Default per city with optional zone link.
2. Maximum distance between warehouses for a same-rider split batch (F18)? Default admin judgement.
