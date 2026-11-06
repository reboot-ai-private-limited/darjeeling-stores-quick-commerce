import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, parse, pathId, sendData, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { AddressService } from "../application/address-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const phone = z.string().transform(value => value.replace(/[\s-]/g, "")).transform(value => (/^\d{10}$/.test(value) ? `+91${value}` : value)).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format such as +919876543210"));
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();

const fields = {
  label: z.enum(["Home", "Work", "Other"]),
  line1: z.string().trim().min(1).max(200),
  localityId: id,
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Use a 6 digit PIN code"),
  landmark: z.string().trim().min(2, "A landmark is required").max(200),
  contactName: z.string().trim().min(1).max(80),
  contactPhone: phone,
  location: point,
  locationAccuracyM: z.number().min(0).max(100_000).nullable(),
  voiceMediaId: id.nullable(),
  housePhotoMediaId: id.nullable(),
  deliveryNotes: z.string().trim().max(300).nullable(),
  makeDefault: z.boolean(),
};

export const addressCreate = z.object({
  label: fields.label.default("Home"), line1: fields.line1, localityId: fields.localityId, pincode: fields.pincode, landmark: fields.landmark,
  contactName: fields.contactName, contactPhone: fields.contactPhone, location: fields.location,
  locationAccuracyM: fields.locationAccuracyM.default(null), voiceMediaId: fields.voiceMediaId.default(null), housePhotoMediaId: fields.housePhotoMediaId.default(null),
  deliveryNotes: fields.deliveryNotes.default(null), makeDefault: fields.makeDefault.default(false),
}).strict();
export const addressUpdate = z.object({
  label: fields.label.optional(), line1: fields.line1.optional(), localityId: fields.localityId.optional(), pincode: fields.pincode.optional(),
  landmark: fields.landmark.optional(), contactName: fields.contactName.optional(), contactPhone: fields.contactPhone.optional(), location: fields.location.optional(),
  locationAccuracyM: fields.locationAccuracyM.optional(), voiceMediaId: fields.voiceMediaId.optional(), housePhotoMediaId: fields.housePhotoMediaId.optional(),
  deliveryNotes: fields.deliveryNotes.optional(), makeDefault: fields.makeDefault.optional(),
}).strict();

/** The 6 endpoints of docs/api/F09-addresses.md. Paths are relative to the API prefix. */
export function addressRoutes(service: AddressService, customer: CustomerResolver): Route[] {
  return [
    { method: "get", path: "/addresses", handler: customerGuarded(customer, async (who, _req, res) => {
      const data = await service.list(who.userId);
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "post", path: "/addresses", handler: customerGuarded(customer, async (who, req, res) => sendData(res, await service.create(who.userId, parse(addressCreate, req.body)), 201)) },
    { method: "get", path: "/addresses/:id", handler: customerGuarded(customer, async (who, req, res) => sendData(res, await service.get(who.userId, pathId(req, "id", "Address")))) },
    { method: "put", path: "/addresses/:id", handler: customerGuarded(customer, async (who, req, res) =>
      sendData(res, await service.update(who.userId, pathId(req, "id", "Address"), parse(addressUpdate, req.body)))) },
    { method: "delete", path: "/addresses/:id", handler: customerGuarded(customer, async (who, req, res) => {
      await service.remove(who.userId, pathId(req, "id", "Address"));
      sendData(res, { ok: true });
    }) },
    // The fixed-looking path is registered with the others; Express matches it by its extra segment.
    { method: "post", path: "/addresses/:id/default", handler: customerGuarded(customer, async (who, req, res) => sendData(res, await service.makeDefault(who.userId, pathId(req, "id", "Address")))) },
  ];
}
