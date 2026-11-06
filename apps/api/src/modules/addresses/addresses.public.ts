import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { noCustomers, type CustomerResolver } from "../catalog/catalog.public.js";
import { createAddressService } from "./application/address-service.js";
import type { AddressMedia } from "./application/ports.js";
import { createMongoAddressStore } from "./infrastructure/mongo-address-store.js";
import { addressRoutes } from "./interface/routes.js";

export type { AddressInput, AddressPatch, AddressService } from "./application/address-service.js";
export type { AddressMedia } from "./application/ports.js";
export { MAX_ADDRESSES, type Address } from "./domain/address.js";
export { addressRoutes } from "./interface/routes.js";

export interface AddressesModuleOptions {
  connection: Connection;
  /** Zones and localities (F03, Dev 1). */
  geography?: Geography;
  /** Voice notes and house photos (F24). */
  media: AddressMedia;
  customer?: CustomerResolver;
}

/** Builds saved addresses (F09). Call `store.ensureIndexes()` once after the database connects. */
export function createAddressesModule({ connection, geography = noGeography, media, customer = noCustomers }: AddressesModuleOptions) {
  const store = createMongoAddressStore(connection);
  const service = createAddressService({ store, geography, media, now: () => new Date(), newId: () => new Types.ObjectId().toHexString() });
  return {
    store, service,
    /** For the cart, quote and orders modules (Dev 1): `forOrder(userId, addressId)` gives an address with its zone. */
    reader: { forOrder: service.forOrder, removeAllFor: service.removeAllFor },
    routes: addressRoutes(service, customer),
  };
}
