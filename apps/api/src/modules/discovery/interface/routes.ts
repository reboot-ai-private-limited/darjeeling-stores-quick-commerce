import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { open, parse, pathId, sendData, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { StoreService } from "../application/store-service.js";
import type { ZoneCatalogService } from "../application/zone-catalog-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
/** No zone, no prices: every catalog call names the zone it is for. */
const zoneId = id;
const flag = z.enum(["true", "false"]).transform(value => value === "true");

export const homeQuery = z.object({ zoneId });
export const productsQuery = z.object({
  zoneId, categoryId: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(40), cursor: z.string().max(100).optional(), inStockOnly: flag.optional(),
});
export const searchQuery = z.object({ zoneId, q: z.string().trim().min(2).max(100), limit: z.coerce.number().int().min(1).max(50).default(20) });
export const changesQuery = z.object({ zoneId, since: z.coerce.number().int().min(0) });

const phone = z.string().transform(value => value.replace(/[\s-]/g, "")).transform(value => (/^\d{10}$/.test(value) ? `+91${value}` : value)).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format such as +919876543210"));
export const waitlistBody = z.object({
  phone: phone.nullish(), localityId: id.nullish(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().nullish(),
}).strict();

/** The 9 endpoints of docs/api/F08-discovery-and-location.md. Paths are relative to the API prefix. All are open to guests. */
export function discoveryRoutes(catalog: ZoneCatalogService, store: StoreService, customer: CustomerResolver): Route[] {
  return [
    { method: "get", path: "/catalog/home", handler: open(async (req, res) => sendData(res, await catalog.home(parse(homeQuery, req.query).zoneId))) },
    { method: "get", path: "/catalog/categories", handler: open(async (req, res) => sendData(res, await catalog.categories(parse(homeQuery, req.query).zoneId))) },
    { method: "get", path: "/catalog/products", handler: open(async (req, res) => {
      const q = parse(productsQuery, req.query);
      const page = await catalog.products(q.zoneId, q);
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
    { method: "get", path: "/catalog/products/:id", handler: open(async (req, res) =>
      sendData(res, await catalog.product(parse(homeQuery, req.query).zoneId, pathId(req, "id", "Product")))) },
    { method: "get", path: "/catalog/search", handler: open(async (req, res) => {
      const q = parse(searchQuery, req.query);
      const data = await catalog.search(q.zoneId, q.q, q.limit);
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "get", path: "/catalog/changes", handler: open(async (req, res) => {
      const q = parse(changesQuery, req.query);
      const result = await catalog.changes(q.zoneId, q.since);
      sendData(res, result.data, 200, { cursor: result.cursor, fullResync: result.fullResync });
    }) },
    { method: "get", path: "/store/status", handler: open(async (req, res) => sendData(res, await store.status(parse(homeQuery, req.query).zoneId))) },
    { method: "get", path: "/banners", handler: open(async (req, res) => sendData(res, await store.banners(parse(homeQuery, req.query).zoneId))) },
    { method: "post", path: "/waitlist", handler: open(async (req, res) => {
      const body = parse(waitlistBody, req.body);
      await store.joinWaitlist(await customer(req), { phone: body.phone ?? null, location: body.location ?? null, localityId: body.localityId ?? null });
      sendData(res, { ok: true }, 201);
    }) },
  ];
}
