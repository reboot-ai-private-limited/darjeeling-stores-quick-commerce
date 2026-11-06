# API · F09 Addresses

Spec: [F09](../customer/09-addresses.md) · Conventions: [00](00-conventions.md)

Voice notes and house photos are uploaded with [F24](F24-media-storage.md) first; the address then stores the returned `mediaId`.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/addresses` | Customer | My saved addresses |
| `POST` | `/addresses` | Customer | Save an address |
| `GET` | `/addresses/:id` | Customer | One address |
| `PUT` | `/addresses/:id` | Customer | Edit an address |
| `DELETE` | `/addresses/:id` | Customer | Delete an address (and its voice note and photo) |
| `POST` | `/addresses/:id/default` | Customer | Make it the default |

## Object: address

```json
{
  "id": "addr_1",
  "label": "Home",
  "line1": "Cedar Villa, 2nd floor",
  "cityId": "city_1",
  "localityId": "loc_1",
  "localityName": "Chowrasta",
  "pincode": "734101",
  "landmark": "Opposite Planters Club gate",
  "contactName": "Asha Rai",
  "contactPhone": "+919876543210",
  "location": { "lat": 27.0410, "lng": 88.2663 },
  "locationAccuracyM": 18,
  "zoneId": "zone_1",
  "isDeliverable": true,
  "isDefault": true,
  "voiceNote": { "mediaId": "media_30", "durationSec": 8 },
  "housePhoto": { "mediaId": "media_31" },
  "deliveryNotes": "Ring the bell twice"
}
```
`voiceNote` and `housePhoto` are `null` when not set. Their files are private: fetch them with `GET /media/:id/url` ([F24](F24-media-storage.md)).

## POST /addresses
Body:
```json
{
  "label": "Home",
  "line1": "Cedar Villa, 2nd floor",
  "localityId": "loc_1",
  "pincode": "734101",
  "landmark": "Opposite Planters Club gate",
  "contactName": "Asha Rai",
  "contactPhone": "+919876543210",
  "location": { "lat": 27.0410, "lng": 88.2663 },
  "locationAccuracyM": 18,
  "voiceMediaId": "media_30",
  "housePhotoMediaId": null,
  "deliveryNotes": "Ring the bell twice",
  "makeDefault": true
}
```
`localityId` and `landmark` are **required**. The server resolves `zoneId` and `isDeliverable` from `location`, and the city and area name from the locality. 201: the address.

Rules: `label` is `Home`, `Work` or `Other` (default `Home`); `line1` up to 200 characters; `landmark` 2 to 200; `pincode` a 6 digit PIN code; `contactPhone` as `+919876543210`, `9876543210` or with spaces and dashes (stored as `+91…`); `deliveryNotes` up to 300; `locationAccuracyM` 0 or more. Unknown fields are refused. A customer can save at most 20 addresses (`400`, `details.reason = "too_many"`). The first address is the default; later ones are only when `makeDefault` is true.

`voiceMediaId` and `housePhotoMediaId` must be the customer's own finished uploads of kind `address_voice` and `address_photo` ([F24](F24-media-storage.md)). They are attached to the address, and one file cannot belong to two addresses.

Errors: `400 VALIDATION_ERROR` (`landmark` or `localityId` missing, or any field above) · `404 NOT_FOUND` (locality unknown or switched off; a media file that does not exist, is not finished, is not the customer's own, or is the wrong kind) · `409 CONFLICT` (the file already belongs to another address) · `422 OUT_OF_ZONE` is **not** returned: an address outside every zone is saved with `isDeliverable: false` so the app can show "Coming soon" and offer the waitlist. A point inside a zone that is **paused** keeps its `zoneId` but has `isDeliverable: false`.

## GET /addresses · GET /addresses/:id
200: `{ "data": [<address>], "meta": { "count": 2 } }`. Another user's id returns `404 NOT_FOUND`.

## PUT /addresses/:id
Same fields as create, all optional. Changing `location` re-resolves the zone. If the address is the one on the cart and its zone changes, the next `PUT /cart` returns a `zoneChange` ([F10](F10-cart-and-quote.md)). Replacing the voice note or photo deletes the old file once the new state is saved; sending `null` removes it (and deletes the file); leaving the field out, or sending the same id, keeps it. If the new file is refused, nothing changes and the old file stays. Changing `localityId` also works out the city and area name again. `makeDefault: true` makes it the default; `false` does nothing (the customer always has a default). 200: the address.

## DELETE /addresses/:id
200: `{ "data": { "ok": true } }`. Deletes the address's voice note and photo. Orders already placed keep their own copies (deleted 7 days after delivery). If it was the default, the customer's newest remaining address becomes the default.

## POST /addresses/:id/default
200: the address with `isDefault: true`. The previous default is cleared. The database allows only one default per customer, even when two devices set one at the same moment.

## Implementation notes (backend, D2-6)

- **For Dev 1.** The cart, quote and orders read an address through `addresses.reader.forOrder(userId, addressId)`, which returns the address with its `zoneId` and `isDeliverable` (or `null` for another customer's id). The cart compares the address's `zoneId` with the cart's to raise `zoneChange`. At order placement, copy the voice note and photo with `media.service.copyToOrder` ([F24](F24-media-storage.md)). When an account is closed, call `addresses.reader.removeAllFor(userId)`.
- **Geography is Dev 1's.** Locality and zone lookups use `Geography` in `apps/api/src/platform/geography.ts` (see [F08](F08-discovery-and-location.md)); with no implementation every save answers `404` for the locality.
- **Stored place.** The location is saved as a GeoJSON point with a 2dsphere index; the locality's name is saved with the address.
- **Known shortcuts.** The zone is worked out when the address is saved or its place changes, not each time it is read, so an address does not notice a zone polygon edited later until it is next saved. Permission keys `address:*` are not checked: any logged-in customer may use these routes, and each only ever sees their own addresses. Until the customer session is connected the routes answer `401`.
