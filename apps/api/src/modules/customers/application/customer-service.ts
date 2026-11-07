import type { AuditEvent } from "../../audit/audit.public.js";
import { conflict, forbidden, notFound, type Ctx } from "../../catalog/catalog.public.js";
import { customerView, TRANSITION_MESSAGE, type Customer, type Transition } from "../domain/customer.js";
import { EXPORT_LIMIT, type CustomerMedia, type CustomerQuery, type CustomerStore, type Outcome } from "./ports.js";

export interface CustomerDeps { store: CustomerStore; media: CustomerMedia; now: () => Date }

const snapshot = (c: Customer) => ({ status: c.status, codAllowed: c.codAllowed });

export function createCustomerService({ store, media, now }: CustomerDeps) {
  /** Changing a customer affects every warehouse, so it needs all-warehouse access. Looking is allowed within a scope. */
  const requireAll = (ctx: Ctx) => { if (!ctx.actor.scope.all) throw forbidden("Changing customers needs all-warehouse access"); };
  const warehouses = (ctx: Ctx) => (ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds);
  const audit = (ctx: Ctx, action: string, id: string, reason?: string, noteAdded?: boolean) => (before: Customer, after: Customer): AuditEvent => ({
    actorId: ctx.actor.userId, actorRole: ctx.actor.role, action, entityType: "customer", entityId: id, requestId: ctx.requestId,
    ...(reason && { reason }), customerChange: { before: snapshot(before), after: { ...snapshot(after), ...(noteAdded && { noteAdded }) } },
  });
  function unwrap<T>(outcome: Outcome<T>, action: Transition | "edit"): T {
    if (outcome.ok) return outcome.value;
    if (outcome.reason === "not_found") throw notFound("Customer");
    if (outcome.reason === "has_active_orders") throw conflict("This customer still has orders in progress");
    throw conflict(action === "edit" ? "This customer cannot be changed" : TRANSITION_MESSAGE[action]);
  }
  async function detail(ctx: Ctx, id: string) {
    const found = await store.get(id, warehouses(ctx));
    if (!found) throw notFound("Customer");
    return {
      ...customerView(found.customer, found.stats),
      addresses: found.addresses, recentOrders: found.recentOrders.map(o => ({ id: o.id, orderNo: o.orderNo, status: o.status, warehouseId: o.warehouseId, total: o.total, createdAt: o.createdAt.toISOString() })),
    };
  }

  return {
    async list(ctx: Ctx, query: Omit<CustomerQuery, "warehouseIds">) {
      const page = await store.list({ ...query, warehouseIds: warehouses(ctx) });
      return { data: page.rows.map(r => customerView(r.customer, r.stats)), nextCursor: page.nextCursor };
    },

    get: detail,

    async edit(ctx: Ctx, id: string, input: { codAllowed?: boolean | undefined; note?: string | undefined }) {
      requireAll(ctx);
      const by = (await store.staffName(ctx.actor.userId)) ?? ctx.actor.userId;
      unwrap(await store.edit({
        id, ...(input.codAllowed !== undefined && { codAllowed: input.codAllowed }), ...(input.note && { note: { text: input.note, by } }), at: now(),
        audit: audit(ctx, "customers.update", id, input.note ? "note added" : undefined, input.note !== undefined),
      }), "edit");
      return detail(ctx, id);
    },

    async block(ctx: Ctx, id: string, reason: string) {
      requireAll(ctx);
      unwrap(await store.transition({ id, action: "block", reason, by: ctx.actor.userId, at: now(), audit: audit(ctx, "customers.block", id, reason) }), "block");
      return detail(ctx, id);
    },

    async unblock(ctx: Ctx, id: string) {
      requireAll(ctx);
      unwrap(await store.transition({ id, action: "unblock", reason: null, by: ctx.actor.userId, at: now(), audit: audit(ctx, "customers.unblock", id) }), "unblock");
      return detail(ctx, id);
    },

    /** Anonymises the account and then removes the address files. A file that cannot be removed now is reported, not hidden; the account is already anonymous. */
    async finaliseDeletion(ctx: Ctx, id: string) {
      requireAll(ctx);
      const { customer, addressIds } = unwrap(await store.finalise({ id, by: ctx.actor.userId, at: now(), audit: audit(ctx, "customers.finalise_deletion", id) }), "finalise");
      let mediaRemoved = 0, mediaFailed = 0;
      for (const addressId of addressIds) {
        try { mediaRemoved += await media.removeAddressMedia(addressId, "account_deletion"); } catch { mediaFailed += 1; }
      }
      return { id: customer.id, status: customer.status, addressesRemoved: addressIds.length, mediaRemoved, mediaFailed };
    },

    /** The customers as CSV. Phone numbers leave the system here, so the export is audited. */
    async exportRows(ctx: Ctx) {
      requireAll(ctx);
      const rows = await store.all(EXPORT_LIMIT);
      await store.recordExport({ actorId: ctx.actor.userId, actorRole: ctx.actor.role, action: "customers.export", entityType: "customer", entityId: "all", requestId: ctx.requestId });
      return {
        columns: ["id", "name", "phone", "status", "codAllowed", "orderCount", "lifetimeValue", "lastOrderAt"],
        rows: rows.map(({ customer: c, stats: s }) => [c.id, c.name, c.phone, c.status, c.codAllowed ? "yes" : "no", s.orderCount, s.lifetimeValue, s.lastOrderAt?.toISOString() ?? null] as (string | number | null)[]),
      };
    },
  };
}

export type CustomerService = ReturnType<typeof createCustomerService>;
