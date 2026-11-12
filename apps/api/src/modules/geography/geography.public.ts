import { Types, type Connection } from "mongoose";
import type { Route } from "../../platform/routes.js";
import { createCityService, type CityService } from "./application/city-service.js";
import { createLocalityService, type LocalityService } from "./application/locality-service.js";
import {
  createResolverService,
  type ResolutionResult,
  type ResolvedZoneInfo,
  type ResolverService,
} from "./application/resolver-service.js";
import {
  createWarehouseService,
  defaultWarehouseDependencyPort,
  type WarehouseService,
} from "./application/warehouse-service.js";
import { createZoneService, type ZoneService } from "./application/zone-service.js";
import type {
  CityStore,
  GeographyActor,
  LocalityStore,
  LockActorFn,
  WarehouseDependencyPort,
  WarehouseStore,
  ZoneStore,
} from "./application/ports.js";
import type { City, CityDTO } from "./domain/city.js";
import { GeographyError, forbidden, unauthorized, type GeographyErrorCode } from "./domain/errors.js";
import type { Coordinate, GeoPolygon, LatLngPoint } from "./domain/geometry.js";
import {
  pointInPolygon,
  pointOnBoundary,
  polygonArea,
  polygonSignedArea,
  polygonsOverlap,
  validatePolygon,
} from "./domain/geometry.js";
import type { Locality, LocalityDTO } from "./domain/locality.js";
import {
  normalizeLocalityName,
  toLocalityDTO,
  validateCoordinates,
} from "./domain/locality.js";
import type { Warehouse, WarehouseDTO } from "./domain/warehouse.js";
import {
  normalizeWarehouseAddress,
  normalizeWarehouseCode,
  toWarehouseDTO,
} from "./domain/warehouse.js";
import type { Zone, ZoneDTO, ZonePause } from "./domain/zone.js";
import { effectivePause, isPauseActive, normalizeZoneName, toZoneDTO } from "./domain/zone.js";
import { createMongoCityStore } from "./infrastructure/mongo-city-store.js";
import { createMongoLocalityStore } from "./infrastructure/mongo-locality-store.js";
import { createMongoWarehouseStore } from "./infrastructure/mongo-warehouse-store.js";
import { createMongoZoneStore } from "./infrastructure/mongo-zone-store.js";
import { createCityRoutes, type AuthResolver, type CsrfValidator } from "./interface/city-routes.js";
import { createLocalityRoutes } from "./interface/locality-routes.js";
import { createResolverRoutes } from "./interface/resolver-routes.js";
import { createWarehouseRoutes } from "./interface/warehouse-routes.js";
import { createZoneRoutes } from "./interface/zone-routes.js";

export type {
  AuthResolver,
  City,
  CityDTO,
  CityService,
  CityStore,
  Coordinate,
  CsrfValidator,
  GeoPolygon,
  GeographyActor,
  LatLngPoint,
  Locality,
  LocalityDTO,
  LocalityService,
  LocalityStore,
  LockActorFn,
  ResolutionResult,
  ResolvedZoneInfo,
  ResolverService,
  Warehouse,
  WarehouseDTO,
  WarehouseDependencyPort,
  WarehouseService,
  WarehouseStore,
  Zone,
  ZoneDTO,
  ZonePause,
  ZoneService,
  ZoneStore,
};
export {
  GeographyError,
  createResolverService,
  createWarehouseService,
  defaultWarehouseDependencyPort,
  effectivePause,
  isPauseActive,
  normalizeLocalityName,
  normalizeWarehouseAddress,
  normalizeWarehouseCode,
  normalizeZoneName,
  pointInPolygon,
  pointOnBoundary,
  polygonArea,
  polygonSignedArea,
  polygonsOverlap,
  toLocalityDTO,
  toWarehouseDTO,
  toZoneDTO,
  validateCoordinates,
  validatePolygon,
  type GeographyErrorCode,
};

export { createGeographyPort } from "./geography-port.js";

export function warehouseDirectoryFrom(geography: { warehouseStore: WarehouseStore }): {
  get(id: string): Promise<{ id: string; zoneId: string; isEnabled: boolean } | null>;
} {
  return {
    async get(id: string) {
      if (!/^[a-fA-F0-9]{24}$/.test(id)) return null;
      const wh = await geography.warehouseStore.findById(id);
      return wh ? { id: wh.id, zoneId: wh.zoneId, isEnabled: wh.isEnabled } : null;
    },
  };
}

export interface GeographyModuleOptions {
  connection: Connection;
  resolveActor?: AuthResolver;
  validateCsrf?: CsrfValidator;
  dependencyPort?: WarehouseDependencyPort | undefined;
  lockActor?: LockActorFn | undefined;
}

export function createGeographyModule({
  connection,
  resolveActor = () => null,
  validateCsrf = () => true,
  dependencyPort,
  lockActor,
}: GeographyModuleOptions) {
  const cityStore = createMongoCityStore(connection);
  const zoneStore = createMongoZoneStore(connection);
  const localityStore = createMongoLocalityStore(connection);
  const warehouseStore = createMongoWarehouseStore(connection);

  const defaultLockActor: LockActorFn = async (actor, session) => {
    if (!actor) {
      throw forbidden("Authentication required");
    }
    if (!actor.id || !Types.ObjectId.isValid(actor.id)) {
      return actor;
    }
    if (actor.authenticate && !await actor.authenticate(session)) {
      throw unauthorized("Session is no longer active");
    }
    const userObjectId = new Types.ObjectId(actor.id);
    const existingUser = await connection.collection("users").findOne({ _id: userObjectId }, { session });
    if (existingUser) {
      if (existingUser.kind !== "staff" || existingUser.status !== "active") {
        throw forbidden("Staff account is deactivated or inactive");
      }
      if (!actor.authenticate) {
        throw unauthorized("Session is no longer active");
      }
      const locked = await connection.collection("users").findOneAndUpdate(
        { _id: userObjectId, kind: "staff", status: "active" },
        { $inc: { authorizationRevision: 1 } },
        { session, returnDocument: "after" }
      );
      if (!locked) {
        throw forbidden("Staff account is deactivated or inactive");
      }
      if (existingUser.roleId) {
        const role = await connection.collection("roles").findOneAndUpdate(
          { _id: existingUser.roleId }, { $inc: { revision: 1 } }, { session, returnDocument: "after" }
        );
        if (role && Array.isArray(role.permissions)) {
          return {
            id: String(existingUser._id),
            roleName: role.name,
            kind: "staff" as const,
            permissions: role.permissions,
            scope: {
              all: existingUser.scope?.all === true,
              warehouseIds: Array.isArray(existingUser.scope?.warehouseIds)
                ? existingUser.scope.warehouseIds.map(String)
                : [],
            },
          };
        }
      }
    }
    if (existingUser) throw forbidden("Staff role is unavailable");
    if (actor.authenticate) throw unauthorized("Staff account is unavailable");
    return actor;
  };

  const actualLockActor = lockActor ?? defaultLockActor;

  const withTransaction = async <T>(fn: (session: import("mongoose").ClientSession) => Promise<T>): Promise<T> => {
    const session = await connection.startSession();
    try {
      return await session.withTransaction(async () => fn(session));
    } finally {
      await session.endSession();
    }
  };

  const cityService = createCityService({
    store: cityStore,    withTransaction,
    newId: () => new Types.ObjectId().toHexString(),
    lockActor: actualLockActor,
  });

  const zoneService = createZoneService({
    zoneStore,
    cityStore,    withTransaction,
    newId: () => new Types.ObjectId().toHexString(),
    lockActor: actualLockActor,
  });

  const localityService = createLocalityService({
    localityStore,
    cityStore,
    zoneStore,    withTransaction,
    newId: () => new Types.ObjectId().toHexString(),
    lockActor: actualLockActor,
  });

  const resolverService = createResolverService({
    zoneStore,
    cityStore,
    localityStore,
  });

  const warehouseService = createWarehouseService({
    warehouseStore,
    zoneStore,
    dependencyPort,    withTransaction,
    newId: () => new Types.ObjectId().toHexString(),
    lockActor: actualLockActor,
  });

  const routes: Route[] = [
    ...createCityRoutes(cityService, resolveActor, validateCsrf),
    ...createZoneRoutes(zoneService, resolveActor, validateCsrf),
    ...createLocalityRoutes(localityService, resolveActor, validateCsrf),
    ...createResolverRoutes(resolverService),
    ...createWarehouseRoutes(warehouseService, resolveActor, validateCsrf),
  ];

  return {
    cityStore,
    cityService,
    zoneStore,
    zoneService,
    localityStore,
    localityService,
    warehouseStore,
    warehouseService,
    resolverService,
    routes,
    async ensureIndexes() {
      await cityStore.ensureIndexes();
      await zoneStore.ensureIndexes();
      await localityStore.ensureIndexes();
      await warehouseStore.ensureIndexes();
    },
  };
}
