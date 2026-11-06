import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, parse, pathId, sendData, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { CartService } from "../application/cart-service.js";
import type { QuoteService } from "../application/quote-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const item = z.object({ productId: id, variantId: id, qty: z.number().int().min(1).max(1000) }).strict();
export const cartBody = z.object({
  clientRev: z.number().int().min(0).max(2_000_000_000), addressId: id.nullish(), zoneId: id.nullish(), items: z.array(item).max(100),
}).strict();
export const couponBody = z.object({ code: z.string().trim().min(1).max(40) }).strict();
export const quoteBody = z.object({
  addressId: id.nullish(), couponCode: z.string().trim().min(1).max(40).nullish(), paymentMethod: z.enum(["cod", "online"]).default("cod"),
  scheduledWindow: z.object({ start: z.coerce.date(), end: z.coerce.date() }).strict().nullish(), acceptZoneChange: z.boolean().default(false),
}).strict().refine(b => !b.scheduledWindow || b.scheduledWindow.end > b.scheduledWindow.start, { path: ["scheduledWindow"], message: "The window must end after it starts" });

/** The 6 endpoints of docs/api/F10-cart-and-quote.md. Paths are relative to the API prefix. */
export function cartRoutes(cart: CartService, quotes: QuoteService, customer: CustomerResolver): Route[] {
  const mine = (h: Parameters<typeof customerGuarded>[1]) => customerGuarded(customer, h);
  return [
    { method: "get", path: "/cart", handler: mine(async (who, _req, res) => sendData(res, await cart.get(who.userId))) },
    { method: "put", path: "/cart", handler: mine(async (who, req, res) => {
      const { stale: _stale, ...result } = await cart.put(who.userId, parse(cartBody, req.body)) as Awaited<ReturnType<CartService["put"]>> & { stale?: true };
      sendData(res, result);
    }) },
    { method: "post", path: "/cart/coupon", handler: mine(async (who, req, res) => sendData(res, await cart.applyCoupon(who.userId, parse(couponBody, req.body).code))) },
    { method: "delete", path: "/cart/coupon", handler: mine(async (who, _req, res) => sendData(res, await cart.removeCoupon(who.userId))) },
    { method: "post", path: "/quotes", handler: mine(async (who, req, res) => {
      const body = parse(quoteBody, req.body);
      sendData(res, await quotes.create(who.userId, {
        addressId: body.addressId, couponCode: body.couponCode, paymentMethod: body.paymentMethod, scheduledWindow: body.scheduledWindow, acceptZoneChange: body.acceptZoneChange,
      }), 201);
    }) },
    { method: "get", path: "/quotes/:id", handler: mine(async (who, req, res) => sendData(res, await quotes.read(who.userId, pathId(req, "id", "Quote")))) },
  ];
}
