import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { AppError, guarded, parse, pathId, sendData, sendError, type AuthResolver, type Ctx } from "../../catalog/catalog.public.js";
import type { CampaignService } from "../application/campaign-service.js";
import type { DeliveryService } from "../application/delivery-service.js";
import type { TemplateService } from "../application/template-service.js";
import { CHANNELS } from "../domain/notification.js";
import { deliveryReportsIn, verifyMetaSignature } from "../domain/webhook.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const channel = z.enum(CHANNELS as unknown as [string, ...string[]]);
const category = z.enum(["utility", "marketing", "authentication"]);
const text = (max: number) => z.string().trim().min(1).max(max);

const templateFields = {
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/, "Use lower_snake_case"), channel,
  title: text(100).nullable(), body: text(1024), whatsappTemplateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Use the provider's template name").nullable(),
  category, language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a code such as en or en_US"), isActive: z.boolean(),
};
export const templateCreate = z.object({
  ...templateFields, title: templateFields.title.default(null), whatsappTemplateName: templateFields.whatsappTemplateName.default(null),
  language: templateFields.language.default("en"), isActive: templateFields.isActive.default(true),
}).strict();
export const templateUpdate = z.object({
  key: templateFields.key.optional(), channel: channel.optional(), title: templateFields.title.optional(), body: templateFields.body.optional(),
  whatsappTemplateName: templateFields.whatsappTemplateName.optional(), category: category.optional(), language: templateFields.language.optional(),
  isActive: z.boolean().optional(),
}).strict();
export const prefsBody = z.object({ promoPush: z.boolean().optional(), promoWhatsApp: z.boolean().optional(), cartReminders: z.boolean().optional() }).strict();
export const logQuery = z.object({
  status: z.enum(["queued", "sent", "delivered", "failed"]).optional(), channel: channel.optional(), userId: id.optional(), orderId: id.optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(100).optional(),
});
export const broadcastBody = z.object({
  zoneIds: z.array(id).min(1).max(50), title: text(100), body: text(500), deepLink: z.string().trim().regex(/^ds:\/\/[a-z]+(\/[A-Za-z0-9_-]+)?$/, "Use a link such as ds://category/<id>").nullable().default(null),
  channels: z.array(z.enum(["push", "whatsapp"])).min(1).max(2).default(["push"]),
}).strict().transform(b => ({ ...b, channels: [...new Set(b.channels)] }));

/** Who the logged-in customer is. Supplied by the identity module's session; until then nobody is logged in. */
export type CustomerResolver = (req: Request) => Promise<{ userId: string } | undefined> | { userId: string } | undefined;
export const noCustomers: CustomerResolver = () => undefined;

export interface WebhookConfig { verifyToken?: string; appSecret?: string }

function asCustomer(resolve: CustomerResolver, handler: (who: { userId: string }, req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res, next) => {
    try {
      const who = await resolve(req);
      if (!who) return sendError(res, new AppError("UNAUTHORIZED", "Authentication required"));
      await handler(who, req, res);
    } catch (error) {
      if (error instanceof AppError) return sendError(res, error);
      next(error);
    }
  };
}

const auditOf = (ctx: Ctx) => ({ actorId: ctx.actor.userId, actorRole: ctx.actor.role, requestId: ctx.requestId });

/** The 10 endpoints of docs/api/F23-notifications.md. Paths are relative to the API prefix. */
export function notificationRoutes(
  services: { templates: TemplateService; delivery: DeliveryService; campaigns: CampaignService },
  customer: CustomerResolver, staff: AuthResolver, webhook: WebhookConfig,
): Route[] {
  const { templates, delivery, campaigns } = services;
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(staff, "notifications:manage", h);

  return [
    { method: "get", path: "/me/notification-prefs", handler: asCustomer(customer, async (who, _req, res) => sendData(res, await delivery.getPrefs(who.userId))) },
    { method: "put", path: "/me/notification-prefs", handler: asCustomer(customer, async (who, req, res) => sendData(res, await delivery.setPrefs(who.userId, parse(prefsBody, req.body)))) },

    { method: "get", path: "/admin/notification-templates", handler: manage(async (_ctx, _req, res) => {
      const data = await templates.list();
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "post", path: "/admin/notification-templates", handler: manage(async (ctx, req, res) =>
      sendData(res, await templates.create(parse(templateCreate, req.body) as never, auditOf(ctx)), 201)) },
    { method: "put", path: "/admin/notification-templates/:id", handler: manage(async (ctx, req, res) =>
      sendData(res, await templates.update(pathId(req, "id", "Template"), parse(templateUpdate, req.body) as never, auditOf(ctx)))) },

    { method: "get", path: "/admin/notifications", handler: manage(async (_ctx, req, res) => {
      const q = parse(logQuery, req.query);
      const page = await delivery.list({ status: q.status, channel: q.channel as never, userId: q.userId, orderId: q.orderId, from: q.from, to: q.to }, q.cursor, q.limit);
      sendData(res, page.items, 200, { nextCursor: page.nextCursor, failedCount: page.failedCount });
    }) },
    { method: "post", path: "/admin/notifications/:id/retry", handler: manage(async (ctx, req, res) =>
      sendData(res, await delivery.retry(pathId(req, "id", "Notification"), auditOf(ctx)))) },
    { method: "post", path: "/admin/broadcast", handler: manage(async (ctx, req, res) =>
      sendData(res, await campaigns.broadcast(parse(broadcastBody, req.body) as never, auditOf(ctx)), 202)) },

    // The provider calls these, not a logged-in person.
    { method: "get", path: "/webhooks/whatsapp", handler: (req, res) => {
      const ok = webhook.verifyToken !== undefined && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === webhook.verifyToken;
      if (!ok) return void res.sendStatus(403);
      res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
    } },
    { method: "post", path: "/webhooks/whatsapp", handler: async (req, res) => {
      // Always answer 200 so the provider does not keep re-sending; only a correctly signed call is acted on.
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      const valid = webhook.appSecret !== undefined && verifyMetaSignature(raw, req.get("X-Hub-Signature-256"), webhook.appSecret);
      if (valid) await delivery.applyWhatsAppReports(deliveryReportsIn(req.body)).catch(() => 0);
      res.sendStatus(200);
    } },
  ];
}
