import type { Connection } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { denyAll, noCustomers, type AuthResolver, type CustomerResolver } from "../catalog/catalog.public.js";
import { createHoursService } from "./application/hours-service.js";
import type { PreorderSource } from "./application/ports.js";
import { createMongoHoursStore } from "./infrastructure/mongo-hours-store.js";
import { hoursRoutes } from "./interface/routes.js";

export type { HoursService, ClosedReason } from "./application/hours-service.js";
export type { PreorderSource } from "./application/ports.js";
export { hoursRoutes } from "./interface/routes.js";
export { isOpen, nextOpening, upcomingSlots, matchSlot, hoursProblem, slotsProblem } from "./domain/hours.js";

export const noPreorders: PreorderSource = { list: async () => [] };

export interface HoursModuleOptions {
  connection: Connection; geography?: Geography; preorders?: PreorderSource; auth?: AuthResolver; customer?: CustomerResolver;
}

/** Builds opening hours, pre-order slots and the pause switch (F17). Call `store.ensureIndexes()` once after the database connects. */
export function createHoursModule(options: HoursModuleOptions) {
  const store = createMongoHoursStore(options.connection);
  const service = createHoursService({ store, geography: options.geography ?? noGeography, preorders: options.preorders ?? noPreorders, now: () => new Date() });
  return { store, service, routes: hoursRoutes(service, options.auth ?? denyAll, options.customer ?? noCustomers) };
}
