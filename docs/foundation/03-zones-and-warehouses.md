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
| One zone per warehouse | `warehouses.zoneId` is a single value; immutable after creation |
| Rider zone | `riders.zoneId` single; `riders.warehouseIds` must all be in that zone |
| Polygon overlap | Rejected on save across all enabled zones; shared edges and vertices allowed |
| Border tie-breaking | Lowest hexadecimal zone ObjectId string wins deterministically before pause evaluation |
| Locality resolution | Linked locality with explicit `zoneId` checks that zone (disabled zone returns not deliverable); unlinked locality resolves stored Point |
| Allocation | Only enabled, open warehouses are candidates (F13) |
| Disabling | A warehouse with active orders cannot be disabled (409 CONFLICT with activeOrders); fail closed if dependency check unavailable |
| Pause authority | Modifying `pause` on zone or warehouse requires `ops_mode:manage` in addition to management permission |

## 5. Screens (admin)
Zones map editor · zone list · warehouse list · warehouse editor (hours, slots, timers, priority) · cities and localities.

## 6. API
Full request and response reference with examples: [API · F03](../api/F03-zones-and-warehouses.md).

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
| address | string | Bounded string (3–500 chars), reconciled with API spec |
| isEnabled, priority | | Lower priority number wins ties |
| hours, lastOrderMinutesBeforeClose, afterHoursMode, preOrder | | F17 |
| packMinutes, riderArrivalMinutes, defaultTravelMinutes | int? | F20 |
| upi | {vpa, payeeName}? | Business VPA, audited (F22) |
| pause | {active, message, until?}? | |
| punchInRadiusMeters | int? | F19 |

Indexes: `zoneId`; `location` 2dsphere; zones `polygon` 2dsphere.

## 8. Settings
`punchInRadiusMeters` (warehouse) · hours and timers live on the warehouse record.

## 9. Permissions & Scope Authority
- `zones:manage`: City, locality, and zone management. Requires `all: true` scope (warehouse-level grants confer no zone authority).
- `warehouses:view`: Read warehouse lists and details. Filters by actor's assigned `scope.warehouseIds` (foreign warehouse detail returns `403 FORBIDDEN`).
- `warehouses:manage`: Warehouse mutations. Requires `all: true` scope for creation (`POST /admin/warehouses`), and target warehouse in scope for updates (`PUT /admin/warehouses/:id`).
- `ops_mode:manage`: Required in addition to management permissions when setting or modifying `pause` on zones or warehouses.
- Customer: `location:resolve_zone` (guest), `zone:check`.

## 10. Open questions
1. Should localities be per zone instead of per city once zones exist? Default per city with optional zone link.
2. Maximum distance between warehouses for a same-rider split batch (F18)? Default admin judgement.
