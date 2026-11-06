import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { noOrders, type OrdersPort } from "../../platform/orders.js";
import { AppError, denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { DEFAULT_RIDER_SETTINGS, noRiders, type RiderResolver, type RiderService } from "../riders/riders.public.js";
import { createAssignService } from "./application/assign-service.js";
import { createBatchService } from "./application/batch-service.js";
import { createBoardService } from "./application/board-service.js";
import type { DispatchDeps } from "./application/context.js";
import { createFieldService } from "./application/field-service.js";
import type { EvidenceMedia, RiderDirectory, RiderNotifier } from "./application/ports.js";
import type { DispatchSettings } from "./domain/dispatch.js";
import { createMongoDispatchStore } from "./infrastructure/mongo-dispatch-store.js";
import { dispatchRoutes } from "./interface/routes.js";

export type { AssignService } from "./application/assign-service.js";
export type { FieldService } from "./application/field-service.js";
export type { EvidenceMedia, RiderDirectory, RiderNotifier } from "./application/ports.js";
export type { DispatchSettings } from "./domain/dispatch.js";
export { dispatchRoutes } from "./interface/routes.js";

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = { ...DEFAULT_RIDER_SETTINGS, assignmentMode: "manual", maxBatchOrders: 3, delayedAfterMinutes: 5 };

/** Sends nothing. Used when no messaging is connected; the rider app still sees assignments by polling. */
export const silentNotifier: RiderNotifier = {
  assigned: async () => undefined, handover: async () => undefined, cancelled: async () => undefined, paid: async () => undefined, unacknowledged: async () => false,
};
const unavailable = () => new AppError("SERVICE_UNAVAILABLE", "Photo storage is not connected");
export const noEvidenceMedia: EvidenceMedia = { claim: async () => { throw unavailable(); }, unclaim: async () => undefined };

export interface DispatchModuleOptions {
  connection: Connection;
  riders: RiderDirectory & Pick<RiderService, "forUser">;
  /** Orders and their one state machine (Dev 1). Without it nothing can be dispatched. */
  orders?: OrdersPort;
  geography?: Geography;
  notifier?: RiderNotifier;
  evidence?: EvidenceMedia;
  settings?: Partial<DispatchSettings>;
  rider?: RiderResolver;
  auth?: AuthResolver;
}

/** Builds dispatch and the rider's delivery steps (F18, F19). Call `store.ensureIndexes()` once after the database connects. */
export function createDispatchModule(options: DispatchModuleOptions) {
  const { connection, riders, orders = noOrders, geography = noGeography, notifier = silentNotifier, evidence = noEvidenceMedia, rider = noRiders, auth = denyAll } = options;
  const settings: DispatchSettings = { ...DEFAULT_DISPATCH_SETTINGS, ...options.settings };
  const store = createMongoDispatchStore(connection);
  const deps: DispatchDeps = { store, riders, orders, geography, notifier, evidence, settings, now: () => new Date(), newId: () => new Types.ObjectId().toHexString() };
  const batches = createBatchService(deps);
  const assign = createAssignService(deps, batches);
  const board = createBoardService(deps);
  const field = createFieldService(deps);
  return {
    store, assign, batches, board, field, settings,
    /** For the orders module (Dev 1): call these when an order is cancelled, paid or becomes ready. */
    hooks: { onOrderCancelled: assign.onOrderCancelled, onOrderPaid: assign.onOrderPaid, autoAssignPending: assign.autoAssignPending },
    routes: dispatchRoutes({ assign, batches, board, field }, riders, rider, auth),
  };
}
