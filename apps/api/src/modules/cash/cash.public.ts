import type { Connection } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { noOrders, type OrdersPort } from "../../platform/orders.js";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { noRiders, type RiderResolver, type RiderService } from "../riders/riders.public.js";
import { createCashService } from "./application/cash-service.js";
import type { OrderRelations, RiderDirectory } from "./application/ports.js";
import { createMongoCashStore } from "./infrastructure/mongo-cash-store.js";
import { cashRoutes } from "./interface/routes.js";

export type { CashService, SyncCollectResult } from "./application/cash-service.js";
export type { OrderRelations, RiderDirectory } from "./application/ports.js";
export { cashRoutes } from "./interface/routes.js";

export interface CashModuleOptions {
  connection: Connection;
  riders: RiderDirectory & Pick<RiderService, "forUser">;
  relations: OrderRelations;
  orders?: OrdersPort;
  geography?: Geography;
  rider?: RiderResolver;
  auth?: AuthResolver;
}

/** Builds rider cash, the ledger, deposits and reconciliation (F22). Call `store.ensureIndexes()` once after the database connects. */
export function createCashModule(options: CashModuleOptions) {
  const { connection, riders, relations, orders = noOrders, geography = noGeography, rider = noRiders, auth = denyAll } = options;
  const store = createMongoCashStore(connection);
  const service = createCashService({ store, orders, riders, relations, geography, now: () => new Date() });
  return { store, service, routes: cashRoutes(service, riders, rider, auth) };
}
