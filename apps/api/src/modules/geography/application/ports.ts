import type { ClientSession } from "mongoose";
import type { City } from "../domain/city.js";
import type { Locality } from "../domain/locality.js";
import type { Warehouse } from "../domain/warehouse.js";
import type { Zone } from "../domain/zone.js";

export interface GeographyActor {
  authenticate?: ((session: ClientSession) => Promise<boolean>) | undefined;
  id?: string | undefined;
  roleName?: string | undefined;
  kind?: ("staff" | "customer" | "rider") | undefined;
  permissions: readonly string[];
  scope: {
    all: boolean;
    warehouseIds: readonly string[];
  };
}

export type LockActorFn = (
  actor: GeographyActor | null | undefined,
  session: ClientSession
) => Promise<GeographyActor>;

export interface CityStore {
  ensureIndexes(): Promise<void>;
  findActive(): Promise<City[]>;
  findAll(): Promise<City[]>;
  findById(id: string, session?: ClientSession): Promise<City | null>;
  findByCanonical(canonicalName: string, canonicalState: string, excludeId?: string, session?: ClientSession): Promise<City | null>;
  create(city: City, session: ClientSession): Promise<City>;
  update(id: string, patch: { name?: string | undefined; state?: string | undefined; canonicalName?: string | undefined; canonicalState?: string | undefined; isActive?: boolean | undefined }, session: ClientSession): Promise<City | null>;
}

export interface ZoneStore {
  ensureIndexes(): Promise<void>;
  findAll(filter?: { cityId?: string | undefined }): Promise<Zone[]>;
  findById(id: string, session?: ClientSession): Promise<Zone | null>;
  findEnabled(excludeId?: string | undefined, session?: ClientSession): Promise<Zone[]>;
  findByNameInCity(cityId: string, name: string, excludeId?: string, session?: ClientSession): Promise<Zone | null>;
  findByPoint(lng: number, lat: number): Promise<Zone[]>;
  create(zone: Zone, session: ClientSession): Promise<Zone>;
  update(id: string, patch: Partial<Zone>, session: ClientSession): Promise<Zone | null>;
  serializeGeometry(session: ClientSession): Promise<number>;
}

export interface LocalityStore {
  ensureIndexes(): Promise<void>;
  findActiveByCity(cityId: string): Promise<Locality[]>;
  findAll(filter?: { cityId?: string | undefined }): Promise<Locality[]>;
  findById(id: string, session?: ClientSession): Promise<Locality | null>;
  findByNameInCity(cityId: string, name: string, excludeId?: string, session?: ClientSession): Promise<Locality | null>;
  create(locality: Locality, session: ClientSession): Promise<Locality>;
  update(id: string, patch: Partial<Locality>, session: ClientSession): Promise<Locality | null>;
}

export interface WarehouseStore {
  ensureIndexes(): Promise<void>;
  findAll(filter?: {
    zoneId?: string | undefined;
    isEnabled?: boolean | undefined;
    ids?: readonly string[] | undefined;
  }): Promise<Warehouse[]>;
  findById(id: string, session?: ClientSession): Promise<Warehouse | null>;
  findByCode(code: string, excludeId?: string | undefined, session?: ClientSession): Promise<Warehouse | null>;
  create(warehouse: Warehouse, session: ClientSession): Promise<Warehouse>;
  update(id: string, patch: Partial<Warehouse>, session: ClientSession): Promise<Warehouse | null>;
}

export interface WarehouseDependencyPort {
  checkCanDisable(
    warehouseId: string,
    session?: ClientSession
  ): Promise<
    | { safe: true; activeOrders: 0 }
    | { safe: false; reason: "dependency_check_unavailable" }
    | { safe: false; activeOrders: number }
  >;
}

