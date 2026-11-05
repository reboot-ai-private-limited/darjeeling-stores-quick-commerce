# API · F03 Cities, Zones & Warehouses

Spec: [F03](../foundation/03-zones-and-warehouses.md) · Conventions: [00](00-conventions.md)

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/location/resolve` | Public | Turn a GPS point or locality into a zone |
| `POST` | `/zones/check` | Public | Same as resolve (kept for address forms) |
| `GET` | `/cities` | Public | Cities for the picker |
| `GET` | `/localities` | Public | Localities (areas, bustys, roads) of a city |
| `GET` | `/admin/cities` | Admin `zones:manage` | List cities (including inactive) |
| `POST` | `/admin/cities` | Admin `zones:manage` | Create a city |
| `PUT` | `/admin/cities/:id` | Admin `zones:manage` | Update a city |
| `GET` | `/admin/localities` | Admin `zones:manage` | List localities |
| `POST` | `/admin/localities` | Admin `zones:manage` | Create a locality |
| `PUT` | `/admin/localities/:id` | Admin `zones:manage` | Update a locality |
| `GET` | `/admin/zones` | Admin `zones:manage` | List zones with polygons |
| `POST` | `/admin/zones` | Admin `zones:manage` | Create a zone (polygon, no overlap) |
| `GET` | `/admin/zones/:id` | Admin `zones:manage` | One zone |
| `PUT` | `/admin/zones/:id` | Admin `zones:manage` | Edit polygon, name, enabled or pause |
| `GET` | `/admin/warehouses` | Admin `warehouses:view` | List warehouses (scoped) |
| `POST` | `/admin/warehouses` | Admin `warehouses:manage` | Create a warehouse in a zone |
| `GET` | `/admin/warehouses/:id` | Admin `warehouses:view` | One warehouse |
| `PUT` | `/admin/warehouses/:id` | Admin `warehouses:manage` | Edit a warehouse |

Hours, pre-order slots and pause switches are in [F17](F17-hours-preorders-and-ops-mode.md).

## POST /location/resolve · POST /zones/check
Body: a point **or** a locality.
```json
{ "lat": 27.0410, "lng": 88.2663 }
```
```json
{ "localityId": "loc_1" }
```
200 (deliverable):
```json
{
  "data": {
    "deliverable": true,
    "zone": { "id": "zone_1", "name": "Mall Road & Chowrasta", "cityId": "city_1" }
  }
}
```
200 (not deliverable):
```json
{ "data": { "deliverable": false } }
```
200 (zone exists but paused):
```json
{ "data": { "deliverable": false, "paused": true, "zone": { "id": "zone_1", "name": "Mall Road & Chowrasta", "cityId": "city_1" } } }
```
Not an error: show "Coming soon to your area" and offer the waitlist (`POST /waitlist`, F08). A point on a zone border counts as inside.

Errors: `400 VALIDATION_ERROR` (invalid coordinates) · `404 NOT_FOUND` (unknown `localityId`).

## GET /cities
200: `{ "data": [{ "id": "city_1", "name": "Darjeeling", "state": "West Bengal", "isActive": true }], "meta": { "count": 1 } }`

## GET /localities
Query: `cityId` (required). 200:
```json
{
  "data": [
    { "id": "loc_1", "cityId": "city_1", "name": "Chowrasta", "location": { "lat": 27.0412, "lng": 88.2630 }, "zoneId": "zone_1", "travelMinutes": 8, "sortOrder": 1, "isActive": true }
  ],
  "meta": { "count": 1 }
}
```

## POST /admin/cities · PUT /admin/cities/:id
Body: `{ "name": "Darjeeling", "state": "West Bengal" }` (PUT also accepts `isActive`). 201/200: the city. `409 CONFLICT` when the name and state exist.

## POST /admin/localities · PUT /admin/localities/:id
Body:
```json
{ "cityId": "city_1", "name": "Chowrasta", "location": { "lat": 27.0412, "lng": 88.2630 }, "zoneId": "zone_1", "travelMinutes": 8, "sortOrder": 1 }
```
`zoneId` and `travelMinutes` are optional (`travelMinutes` is the ETA fallback, F20). 201/200: the locality. `GET /admin/localities?cityId=` filters.

## POST /admin/zones
Body:
```json
{
  "cityId": "city_1",
  "name": "Mall Road & Chowrasta",
  "polygon": {
    "type": "Polygon",
    "coordinates": [[[88.260, 27.035], [88.275, 27.035], [88.275, 27.050], [88.260, 27.050], [88.260, 27.035]]]
  },
  "isEnabled": true
}
```
One outer ring, closed (first = last), `[lng, lat]`. 201:
```json
{ "data": { "id": "zone_1", "cityId": "city_1", "name": "Mall Road & Chowrasta", "polygon": { "type": "Polygon", "coordinates": [[[88.260, 27.035], [88.275, 27.035], [88.275, 27.050], [88.260, 27.050], [88.260, 27.035]]] }, "isEnabled": true } }
```
Errors: `400 INVALID_POLYGON` (`details` lists the problems) · `409 ZONE_OVERLAP` (`details.zoneId`, `details.name`). Zones that only share a border are allowed.

## GET /admin/zones · GET /admin/zones/:id
200: zone objects as above, plus `pause` when set: `"pause": { "active": true, "message": "…", "until": "…" }`.

## PUT /admin/zones/:id
Body (all optional): `{ "name": "…", "polygon": { … }, "isEnabled": false, "pause": { "active": true, "message": "Landslide on Hill Cart Road", "until": "2026-11-05T14:00:00Z" } }`. Send `"pause": null` to clear. Re-validates the polygon and overlap. 200: the zone. Errors as above plus `404 NOT_FOUND`.

## POST /admin/warehouses
Body:
```json
{
  "zoneId": "zone_1",
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
`code` is unique and upper-cased. A warehouse belongs to exactly one zone. 201:
```json
{
  "data": {
    "id": "wh_1", "zoneId": "zone_1", "name": "Chowrasta store", "code": "CHOW-1",
    "location": { "lat": 27.0410, "lng": 88.2663 }, "address": "Mall Road, Darjeeling",
    "isEnabled": true, "priority": 1,
    "packMinutes": 5, "riderArrivalMinutes": 5, "defaultTravelMinutes": 10, "punchInRadiusMeters": 150
  }
}
```
Errors: `404 NOT_FOUND` (zone) · `409 CONFLICT` (code exists).

## GET /admin/warehouses · GET /admin/warehouses/:id
Query: `?zoneId=`, `?isEnabled=`. Scoped staff only see the warehouses in their scope (others return `403 FORBIDDEN` on `:id`).

## PUT /admin/warehouses/:id
Body (all optional): `name`, `location`, `address`, `isEnabled`, `priority`, `packMinutes`, `riderArrivalMinutes`, `defaultTravelMinutes`, `punchInRadiusMeters`, `pause`. 200: the warehouse.

Errors: `409 CONFLICT` when disabling a warehouse that still has active orders (`details.activeOrders`).
