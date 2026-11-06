import type { Geography } from "../../../platform/geography.js";
import type { DeliveryOrder, OrderActor, OrdersPort } from "../../../platform/orders.js";
import type { Ctx } from "../../catalog/catalog.public.js";
import type { DispatchSettings } from "../domain/dispatch.js";
import type { DispatchStore, EvidenceMedia, RiderDirectory, RiderNotifier } from "./ports.js";

export interface DispatchDeps {
  store: DispatchStore; riders: RiderDirectory; orders: OrdersPort; geography: Geography; notifier: RiderNotifier; evidence: EvidenceMedia;
  settings: DispatchSettings; now: () => Date; newId: () => string;
}

/** Who is making a dispatch decision: an admin, or the system in auto mode. */
export type Decider = { kind: "admin"; ctx: Ctx } | { kind: "system" };

export const orderActorOf = (who: Decider): OrderActor => (who.kind === "admin" ? { kind: "admin", id: who.ctx.actor.userId } : { kind: "system", id: "dispatch" });

export function auditFor(who: Decider, action: string, entityType: string, entityId: string, warehouseId?: string) {
  return who.kind === "admin"
    ? { actorId: who.ctx.actor.userId, actorRole: who.ctx.actor.role, requestId: who.ctx.requestId, action, entityType, entityId, ...(warehouseId && { warehouseId }) }
    : null;
}

/** The part of an order a rider needs on a list. */
export async function orderSummary(deps: DispatchDeps, order: DeliveryOrder) {
  const warehouse = await deps.geography.warehouse(order.warehouseId);
  return {
    id: order.id, orderNo: order.orderNo, groupId: order.groupId, status: order.status,
    warehouse: { id: order.warehouseId, name: warehouse?.name ?? "", location: warehouse?.location ?? null },
    customerName: order.customer.name, locality: order.address.locality, itemCount: order.itemCount, amountDue: order.amountDue,
    paymentStatus: order.paymentStatus, promisedAt: order.promisedAt.toISOString(),
  };
}
