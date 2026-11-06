# API · F03 Cities, Zones & Warehouses

Spec: [F03](../foundation/03-zones-and-warehouses.md) · Conventions: [00](00-conventions.md) · Plan: [F03 Plan](../../tasks/f03-implementation-plan.md)

Implementation status (2026-11-06): all 18 endpoint handlers below are implemented, tested, and verified. The authoritative geography interface `createGeographyModule` is mounted into the application server with real staff session authentication, CSRF validation, transactional audit writes, and 2dsphere spatial indexing. Full end-to-end integration tests verify city CRUD, zone polygon overlap rejection, locality administration with zone linking, deterministic point and locality resolution with border tie-breaking, scoped warehouse management, and guarded warehouse disabling. In `apps/web`, the administrative workspace connects live screens for Cities & Localities (`cities-localities.tsx`), Zone Map & Polygon Editor (`zones-editor.tsx`), and Scoped Warehouses (`warehouses.tsx`).

Audit fixes (2026-11-06): Geography mutations revalidate and lock the original access session inside their transaction, together with current staff authority. Logout and access-token rotation invalidate pending writes before commit. Polygon overlap and the public point/boundary helpers use [S2 spherical geometry](https://github.com/missinglink/s2js), matching great-circle edges in MongoDB 2dsphere queries; adjacent shared boundaries remain legal. Pause controls are offered only when editing existing zones/warehouses because POST does not accept pause. New warehouses are enabled; disable remains a guarded edit operation.

Contract reconciliation (2026-11-06):
- All identifier parameters and fields in transport use 24-character hexadecimal MongoDB ObjectIds. Example values like `city_1`, `zone_1`, `loc_1`, `wh_1` below represent these standard hex IDs.
- Scoped authority: `zones:manage` requires `all: true` scope (warehouse grants confer no zone-level authority). `warehouses:view` allows viewing scoped warehouses (filtered list, 403 on foreign `:id`). `warehouses:manage` requires `all: true` scope for warehouse creation (`POST /admin/warehouses`), and target warehouse in scope for updates (`PUT /admin/warehouses/:id`).
- Pause authority: Updating `pause` on `PUT /admin/zones/:id` or `PUT /admin/warehouses/:id` requires `ops_mode:manage` permission in addition to `zones:manage` or `warehouses:manage`. Expired pauses are evaluated as inactive at read time.
- Address representation: Warehouse `address` is a bounded non-empty string (`min(3).max(500)`), consistent with API examples.
- Immutability: Warehouse `code` and `zoneId` are immutable on `PUT /admin/warehouses/:id`. Zone `cityId` is immutable on `PUT /admin/zones/:id`.
- Locality resolution precedence: Active locality and active city required (unknown or inactive returns 404). If the locality has an explicit `zoneId`, checks that zone: if enabled, resolves to it; if disabled, returns `{ "data": { "deliverable": false } }` (does not fall back to point). If locality has no explicit `zoneId`, resolves its stored `{ lat, lng }` point against enabled zones.
- Border tie-breaking: On a shared border between two enabled zones, the zone with the lowest hexadecimal ObjectId string wins deterministically before pause evaluation.
- Guarded warehouse disable: Disabling a warehouse requires active order/rider dependency checks. If the dependency check is unavailable, returns `409 CONFLICT` with details `{ reason: "dependency_check_unavailable" }`. If active orders exist, returns `409 CONFLICT` with details `{ activeOrders: N }`. Ordinary edits without disabling succeed even when disable is guarded.
- Operating status: Missing open hours / config is represented as unknown / not order-eligible; never invent a 24-hour schedule. Real operating hours belong to F17.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/location/resolve` | Public | Turn a GPS point or locality into a zone |
| `POST` | `/zones/check` | Public | Same as resolve (alias kept for address forms) |
| `GET` | `/cities` | Public | Active cities for the picker |
| `GET` | `/localities` | Public | Active localities of an active city |
| `GET` | `/admin/cities` | Admin `zones:manage` (all scope) | List cities (including inactive) |
| `POST` | `/admin/cities` | Admin `zones:manage` (all scope) | Create a city |
| `PUT` | `/admin/cities/:id` | Admin `zones:manage` (all scope) | Update a city |
| `GET` | `/admin/localities` | Admin `zones:manage` (all scope) | List localities (optional `?cityId=`) |
| `POST` | `/admin/localities` | Admin `zones:manage` (all scope) | Create a locality |
| `PUT` | `/admin/localities/:id` | Admin `zones:manage` (all scope) | Update a locality |
| `GET` | `/admin/zones` | Admin `zones:manage` (all scope) | List zones with polygons and pause status |
| `POST` | `/admin/zones` | Admin `zones:manage` (all scope) | Create a zone (polygon, no overlap) |
| `GET` | `/admin/zones/:id` | Admin `zones:manage` (all scope) | One zone with polygon and pause status |
| `PUT` | `/admin/zones/:id` | Admin `zones:manage` (all scope; `ops_mode:manage` if modifying `pause`) | Edit polygon, name, enabled or pause |
| `GET` | `/admin/warehouses` | Admin `warehouses:view` | List warehouses (filtered by actor's scope) |
| `POST` | `/admin/warehouses` | Admin `warehouses:manage` (all scope) | Create a warehouse in a zone |
| `GET` | `/admin/warehouses/:id` | Admin `warehouses:view` | One warehouse (403 if foreign scope) |
| `PUT` | `/admin/warehouses/:id` | Admin `warehouses:manage` (scoped; `ops_mode:manage` if modifying `pause`) | Edit a warehouse; guarded disable |

Hours, pre-order slots and pause switches are in [F17](F17-hours-preorders-and-ops-mode.md).

## POST /location/resolve · POST /zones/check
Auth: Public.
Body: Exactly one of a point (`lat`, `lng`) **or** a locality (`localityId`). Supplying both or neither returns `400 VALIDATION_ERROR`.

```json
{ "lat": 27.0410, "lng": 88.2663 }
```
```json
{ "localityId": "672b123456789abcdef01234" }
```

200 (deliverable):
```json
{
  "data": {
    "deliverable": true,
    "zone": { "id": "672b123456789abcdef01201", "name": "Mall Road & Chowrasta", "cityId": "672b123456789abcdef01101" }
  }
}
```

200 (not deliverable):
```json
{ "data": { "deliverable": false } }
```

200 (zone exists but paused):
```json
{
  "data": {
    "deliverable": false,
    "paused": true,
    "zone": { "id": "672b123456789abcdef01201", "name": "Mall Road & Chowrasta", "cityId": "672b123456789abcdef01101" }
  }
}
```

Not an error: show "Coming soon to your area" and offer the waitlist (`POST /waitlist`, F08).
- A point on a zone border counts as inside.
- If a point falls on a shared border between two enabled zones, the zone with the lowest hexadecimal ObjectId string wins deterministically before pause evaluation.
- For `localityId`, if the locality has an explicit `zoneId`, checks that zone: if enabled, resolves to it; if disabled, returns `{ "data": { "deliverable": false } }` (does not fall back to point). If the locality has no explicit `zoneId`, resolves its stored `{ lat, lng }` point against enabled zones.
- `deliverable` reflects geographic serviceability under active cities and enabled zones.

Errors: `400 VALIDATION_ERROR` (invalid coordinates, missing both, or supplying both) · `404 NOT_FOUND` (unknown or inactive `localityId` or inactive parent city).

## GET /cities
Auth: Public. Returns active cities only.
200:
```json
{
  "data": [
    { "id": "672b123456789abcdef01101", "name": "Darjeeling", "state": "West Bengal", "isActive": true }
  ],
  "meta": { "count": 1 }
}
```

## GET /localities
Auth: Public.
Query: `cityId` (required, 24-char hex ObjectId).
Returns active localities under an active city, ordered by `sortOrder` ascending, then `name` ascending. If city is unknown or inactive, returns `404 NOT_FOUND`.

200:
```json
{
  "data": [
    {
      "id": "672b123456789abcdef01301",
      "cityId": "672b123456789abcdef01101",
      "name": "Chowrasta",
      "location": { "lat": 27.0412, "lng": 88.2630 },
      "zoneId": "672b123456789abcdef01201",
      "travelMinutes": 8,
      "sortOrder": 1,
      "isActive": true
    }
  ],
  "meta": { "count": 1 }
}
```

## GET /admin/cities
Auth: Staff `zones:manage` (requires `all: true` scope).
Returns all cities (including inactive), sorted by `name` ascending.
200:
```json
{
  "data": [
    { "id": "672b123456789abcdef01101", "name": "Darjeeling", "state": "West Bengal", "isActive": true }
  ],
  "meta": { "count": 1 }
}
```

## POST /admin/cities
Auth: Staff `zones:manage` (requires `all: true` scope).
Body:
```json
{ "name": "Darjeeling", "state": "West Bengal" }
```
- `name`: 1–100 chars, trimmed.
- `state`: 1–100 chars, trimmed.
- Canonical unique index on `(name, state)` case-insensitively.

201: Created City object (includes `id`, `name`, `state`, `isActive: true`).
Errors: `400 VALIDATION_ERROR` · `409 CONFLICT` (when canonical `(name, state)` already exists).

## PUT /admin/cities/:id
Auth: Staff `zones:manage` (requires `all: true` scope).
Body (at least one field):
```json
{ "name": "Darjeeling", "state": "West Bengal", "isActive": true }
```
200: Updated City object.
Errors: `400 VALIDATION_ERROR` · `404 NOT_FOUND` · `409 CONFLICT` (duplicate canonical name/state).

## GET /admin/localities
Auth: Staff `zones:manage` (requires `all: true` scope).
Query: `?cityId=` (optional filter).
Returns all localities (including inactive) matching the filter, ordered by `sortOrder` ascending, then `name` ascending.
200:
```json
{
  "data": [
    {
      "id": "672b123456789abcdef01301",
      "cityId": "672b123456789abcdef01101",
      "name": "Chowrasta",
      "location": { "lat": 27.0412, "lng": 88.2630 },
      "zoneId": "672b123456789abcdef01201",
      "travelMinutes": 8,
      "sortOrder": 1,
      "isActive": true
    }
  ],
  "meta": { "count": 1 }
}
```

## POST /admin/localities
Auth: Staff `zones:manage` (requires `all: true` scope).
Body:
```json
{
  "cityId": "672b123456789abcdef01101",
  "name": "Chowrasta",
  "location": { "lat": 27.0412, "lng": 88.2630 },
  "zoneId": "672b123456789abcdef01201",
  "travelMinutes": 8,
  "sortOrder": 1
}
```
- `cityId`: required, 24-char hex ObjectId of existing city.
- `name`: 1–100 chars, trimmed. Unique per `cityId`.
- `location`: `{ lat, lng }` where lat in [-90, 90], lng in [-180, 180].
- `zoneId`: optional 24-char hex ObjectId. If provided, must belong to the same `cityId`.
- `travelMinutes`: optional integer >= 0 (ETA fallback, F20).
- `sortOrder`: optional integer >= 0, default 0.

201: Created Locality object (includes `isActive: true`).
Errors: `400 VALIDATION_ERROR` · `404 NOT_FOUND` (city or zone not found) · `409 CONFLICT` (name exists in city, or zone does not belong to city).

## PUT /admin/localities/:id
Auth: Staff `zones:manage` (requires `all: true` scope).
Body (all optional, at least one):
```json
{
  "name": "Chowrasta",
  "cityId": "672b123456789abcdef01101",
  "location": { "lat": 27.0412, "lng": 88.2630 },
  "zoneId": "672b123456789abcdef01201",
  "travelMinutes": 8,
  "sortOrder": 1,
  "isActive": true
}
```
- Explicit `null` on `zoneId` or `travelMinutes` clears the optional field.
- If `cityId` is updated, the resulting `zoneId` (new or existing) must belong to the target city.

200: Updated Locality object.
Errors: `400 VALIDATION_ERROR` · `404 NOT_FOUND` · `409 CONFLICT` (duplicate name or cross-city zone mismatch).

## GET /admin/zones
Auth: Staff `zones:manage` (requires `all: true` scope).
Query: `?cityId=` (optional filter).
Returns all zones matching the filter, with their polygons and pause status.
200:
```json
{
  "data": [
    {
      "id": "672b123456789abcdef01201",
      "cityId": "672b123456789abcdef01101",
      "name": "Mall Road & Chowrasta",
      "polygon": {
        "type": "Polygon",
        "coordinates": [[[88.260, 27.035], [88.275, 27.035], [88.275, 27.050], [88.260, 27.050], [88.260, 27.035]]]
      },
      "isEnabled": true,
      "pause": null
    }
  ],
  "meta": { "count": 1 }
}
```

## GET /admin/zones/:id
Auth: Staff `zones:manage` (requires `all: true` scope).
200: Zone object as above.
Errors: `404 NOT_FOUND`.

## POST /admin/zones
Auth: Staff `zones:manage` (requires `all: true` scope).
Body:
```json
{
  "cityId": "672b123456789abcdef01101",
  "name": "Mall Road & Chowrasta",
  "polygon": {
    "type": "Polygon",
    "coordinates": [[[88.260, 27.035], [88.275, 27.035], [88.275, 27.050], [88.260, 27.050], [88.260, 27.035]]]
  },
  "isEnabled": true
}
```
Polygon requirements:
- Exactly one outer ring, closed (first point equals last point), GeoJSON standard `[lng, lat]` coordinates order.
- Minimum 4 coordinates (3 distinct vertices + 1 closing). Maximum 1,000 vertices.
- Finite coordinates: latitude in [-85, 85], longitude in [-180, 180]. No antimeridian crossing.
- Positive non-zero area, no self-intersections.
- Overlap prohibition: No positive-area overlap with any other enabled zone across all cities. Shared edges and vertices are allowed. Containment or identical polygons count as overlap.
- Concurrency: Serialized by updating a durable geography version record before candidate reads, overlap checks, and commit.

201: Created Zone object (includes `id`, `cityId`, `name`, `polygon`, `isEnabled: true`, `pause: null`).
Errors: `400 INVALID_POLYGON` (`details` lists geometry errors) · `404 NOT_FOUND` (cityId) · `409 ZONE_OVERLAP` (`details.zoneId`, `details.name`) · `409 CONFLICT` (duplicate name in city).

## PUT /admin/zones/:id
Auth: Staff `zones:manage` (requires `all: true` scope).
If `pause` field is present/modified, actor also requires `ops_mode:manage`.
`cityId` is immutable and cannot be changed.

Body (all optional, at least one):
```json
{
  "name": "Mall Road & Chowrasta",
  "polygon": {
    "type": "Polygon",
    "coordinates": [[[88.260, 27.035], [88.275, 27.035], [88.275, 27.050], [88.260, 27.050], [88.260, 27.035]]]
  },
  "isEnabled": true,
  "pause": {
    "active": true,
    "message": "Landslide on Hill Cart Road",
    "until": "2026-11-05T14:00:00Z"
  }
}
```
- Send `"pause": null` to clear pause state.
- Re-enabling (`isEnabled: true`) or updating `polygon` reruns the serialized overlap check against all other enabled zones.
- Expired `pause.until` values are evaluated as inactive at read time.

200: Updated Zone object.
Errors: `400 INVALID_POLYGON` · `403 FORBIDDEN` (e.g. missing `ops_mode:manage` for pause) · `404 NOT_FOUND` · `409 ZONE_OVERLAP` · `409 CONFLICT`.

## GET /admin/warehouses
Auth: Staff `warehouses:view`.
Query: `?zoneId=`, `?isEnabled=`.
Scoped staff only see warehouses within their assigned `scope.warehouseIds`. Staff with `scope.all: true` see all warehouses matching query filters.
200:
```json
{
  "data": [
    {
      "id": "672b123456789abcdef01401",
      "zoneId": "672b123456789abcdef01201",
      "name": "Chowrasta store",
      "code": "CHOW-1",
      "location": { "lat": 27.0410, "lng": 88.2663 },
      "address": "Mall Road, Darjeeling",
      "isEnabled": true,
      "priority": 1,
      "packMinutes": 5,
      "riderArrivalMinutes": 5,
      "defaultTravelMinutes": 10,
      "punchInRadiusMeters": 150,
      "pause": null
    }
  ],
  "meta": { "count": 1 }
}
```

## GET /admin/warehouses/:id
Auth: Staff `warehouses:view`.
Returns the warehouse object. If the warehouse exists but is outside the actor's scope (`scope.all` is false and `id` is not in `scope.warehouseIds`), returns `403 FORBIDDEN`.
Errors: `403 FORBIDDEN` (foreign scope) · `404 NOT_FOUND`.

## POST /admin/warehouses
Auth: Staff `warehouses:manage` (requires `all: true` scope).
Body:
```json
{
  "zoneId": "672b123456789abcdef01201",
  "name": "Chowrasta store",
  "code": "CHOW-1",
  "location": { "lat": 27.0410, "lng": 88.2663 },
  "address": "Mall Road, Darjeeling",
  "priority": 1,
  "packMinutes": 5,
  "riderArrivalMinutes": 5,
  "defaultTravelMinutes": 10,
  "punchInRadiusMeters": 150
}
```
Validation limits:
- `zoneId`: required 24-char hex ObjectId of existing zone. Immutable after creation.
- `name`: 1–100 chars, trimmed.
- `code`: 2–20 uppercase alphanumeric chars/hyphens (`^[A-Z0-9-]{2,20}$`). Unique canonical index. Immutable after creation.
- `location`: `{ lat, lng }` where lat in [-90, 90], lng in [-180, 180]. Stored internally as GeoJSON Point `[lng, lat]`.
- `address`: bounded non-empty string, min 3, max 500 characters.
- `priority`: integer >= 1 (lower number = higher priority).
- `packMinutes`: integer >= 0, default 5.
- `riderArrivalMinutes`: integer >= 0, default 5.
- `defaultTravelMinutes`: integer >= 0, default 10.
- `punchInRadiusMeters`: integer >= 0, default 150.

201: Created Warehouse object (includes `isEnabled: true`, `pause: null`).
Errors: `400 VALIDATION_ERROR` · `404 NOT_FOUND` (zoneId) · `409 CONFLICT` (code already exists).

## PUT /admin/warehouses/:id
Auth: Staff `warehouses:manage` (requires target warehouse to be in actor's scope, or `all: true` scope).
If `pause` field is present/modified, actor also requires `ops_mode:manage`.
`code` and `zoneId` are immutable and cannot be updated.

Body (all optional, at least one):
```json
{
  "name": "Chowrasta store",
  "location": { "lat": 27.0410, "lng": 88.2663 },
  "address": "Mall Road, Darjeeling",
  "isEnabled": false,
  "priority": 1,
  "packMinutes": 5,
  "riderArrivalMinutes": 5,
  "defaultTravelMinutes": 10,
  "punchInRadiusMeters": 150,
  "pause": {
    "active": true,
    "message": "Temporary maintenance",
    "until": "2026-11-05T18:00:00Z"
  }
}
```
Guarded disable:
- Disabling a warehouse (`isEnabled: false`) triggers authoritative dependency checks against active orders and active riders.
- If dependency checking is unavailable, returns `409 CONFLICT` with `{ "error": { "code": "CONFLICT", "message": "Warehouse cannot be disabled: dependency check unavailable", "details": { "reason": "dependency_check_unavailable" } } }`.
- If active orders exist for this warehouse, returns `409 CONFLICT` with `{ "error": { "code": "CONFLICT", "message": "Warehouse has active orders", "details": { "activeOrders": 3 } } }`.
- Ordinary updates (e.g. updating name or timers while keeping `isEnabled: true`) succeed without dependency failure.

200: Updated Warehouse object.
Errors: `400 VALIDATION_ERROR` · `403 FORBIDDEN` (outside scope or missing `ops_mode:manage` for pause) · `404 NOT_FOUND` · `409 CONFLICT` (guarded disable blocked).
