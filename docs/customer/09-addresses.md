# F09 – Addresses

Status: draft v3 · Folder: customer · Depends on: F03, F24 · See also: F08, F10, F19 (rider view)

## 1. Purpose
Capture an address a rider can actually find in hilly terrain, where GPS pins are inaccurate and roads wind.

## 2. Flow

1. Customer drops a pin on the map (Google Maps + Places) → `POST /zones/check` resolves the zone.
2. Outside every zone → "Coming soon" (F08). Inside → "Delivering to this area · 15–20 min".
3. Customer fills the form: **locality / area / busty / road** (dropdown from the city's list), house or building, **landmark (required)**, contact name and phone, label (Home / Work / Other).
4. Optional **10-second voice note** and **house photo** for the rider.
5. Save → the address stores `zoneId` and `isDeliverable`.
6. At order placement the voice note and photo are **copied** to the order (F24), so later edits do not affect an order in flight.

## 3. Rules

| Rule | Detail |
|---|---|
| Landmark | Required |
| Locality | Required, from the `localities` dropdown |
| GPS accuracy | Stored; a poor-accuracy warning is shown, the landmark text is what riders rely on |
| Zone | Resolved at save. An address in another zone triggers the cart zone-change rule (F10) |
| Voice note | ≤ 10 s, uploaded straight to S3 through a retry queue; the order can be placed before the upload finishes |
| House photo | Resized to 1080 px; optional |
| Deletion | Deleting an address deletes its voice note and photo from S3 (F24). Order copies follow their own 7-day rule |
| Defaults | One default address per customer |
| Receiver | Contact name and phone can differ from the account holder |

## 4. Screens (customer)
Map pin with zone banner · address form (locality, house, landmark, voice note, photo, label) · saved addresses list · address picker in checkout.

## 5. API
Full request and response reference with examples: [API · F09](../api/F09-addresses.md).

`GET/POST/PUT/DELETE /addresses` · `POST /addresses/:id/default` · `POST /media/upload-url` and `POST /media/complete` (F24).

## 6. Data

**addresses**

| Field | Type | Notes |
|---|---|---|
| userId | ref | |
| label | string | Home / Work / Other |
| line1, cityId, localityId, pincode | | Locality required |
| landmark | string | **Required** |
| contactName, contactPhone | | Receiver |
| location | Point | 2dsphere; `locationAccuracyM` stored |
| zoneId | ref? | Resolved on save |
| isDeliverable | bool | |
| voiceMediaId | ref media_files? | ≤ 10 s, customer-controlled |
| housePhotoMediaId | ref media_files? | |
| deliveryNotes | string? | |

## 7. Settings
`media.maxVoiceSeconds` (10) · `media.maxImageMB` (5) · `media.orderMediaRetentionDays` (7).

## 8. Permissions
`address:list`, `address:create`, `address:update`, `address:delete`, `address:set_default`, `media:upload`, `media:delete_own`.

## 9. Open questions
1. Keep an address-level voice note at all, or only per-order notes? Default: address-level allowed, order gets its own copy deleted 7 days after delivery.
2. House photo deleted with the voice note after 7 days? Default yes.
