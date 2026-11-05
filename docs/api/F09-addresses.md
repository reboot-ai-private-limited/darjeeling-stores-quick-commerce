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
`localityId` and `landmark` are **required**. The server resolves `zoneId` and `isDeliverable` from `location`. 201: the address.

Errors: `400 VALIDATION_ERROR` (`landmark` or `localityId` missing) · `404 NOT_FOUND` (locality or media) · `422 OUT_OF_ZONE` is **not** returned: an address outside every zone is saved with `isDeliverable: false` so the app can show "Coming soon" and offer the waitlist.

## GET /addresses · GET /addresses/:id
200: `{ "data": [<address>], "meta": { "count": 2 } }`. Another user's id returns `404 NOT_FOUND`.

## PUT /addresses/:id
Same fields as create, all optional. Changing `location` re-resolves the zone. If the address is the one on the cart and its zone changes, the next `PUT /cart` returns a `zoneChange` ([F10](F10-cart-and-quote.md)). Replacing the voice note or photo deletes the old file. 200: the address.

## DELETE /addresses/:id
200: `{ "data": { "ok": true } }`. Deletes the address's voice note and photo. Orders already placed keep their own copies (deleted 7 days after delivery).

## POST /addresses/:id/default
200: the address with `isDefault: true`. The previous default is cleared.
