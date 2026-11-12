import type { ClientSession } from "mongoose";
import { conflict, forbidden, notFound, validationError } from "../domain/errors.js";
import { validateCoordinates } from "../domain/locality.js";
import type { LatLngPoint } from "../domain/geometry.js";
import {
  normalizeWarehouseAddress,
  normalizeWarehouseCode,
  toWarehouseDTO,
  type Warehouse,
  type WarehouseDTO,
} from "../domain/warehouse.js";
import type { ZonePause } from "../domain/zone.js";
import type {
  GeographyActor,
  LockActorFn,
  WarehouseDependencyPort,
  WarehouseStore,
  ZoneStore,
} from "./ports.js";

export interface ListWarehouseFilter {
  zoneId?: string | undefined;
  isEnabled?: boolean | undefined;
}

export interface CreateWarehouseInput {
  zoneId: string;
  name: string;
  code: string;
  location: LatLngPoint;
  address: string;
  priority?: number | undefined;
  packMinutes?: number | undefined;
  riderArrivalMinutes?: number | undefined;
  defaultTravelMinutes?: number | undefined;
  punchInRadiusMeters?: number | undefined;
}

export interface UpdateWarehouseInput {
  name?: string | undefined;
  location?: LatLngPoint | undefined;
  address?: string | undefined;
  isEnabled?: boolean | undefined;
  priority?: number | undefined;
  packMinutes?: number | undefined;
  riderArrivalMinutes?: number | undefined;
  defaultTravelMinutes?: number | undefined;
  punchInRadiusMeters?: number | undefined;
  pause?: ZonePause | null | undefined;
}

export interface WarehouseServiceDependencies {
  warehouseStore: WarehouseStore;
  zoneStore: ZoneStore;
  dependencyPort?: WarehouseDependencyPort | undefined;
  withTransaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  newId: () => string;
  lockActor?: LockActorFn | undefined;
}

export const defaultWarehouseDependencyPort: WarehouseDependencyPort = {
  checkCanDisable: async () => ({ safe: false, reason: "dependency_check_unavailable" }),
};

export function createWarehouseService(deps: WarehouseServiceDependencies) {
  const dependencyPort = deps.dependencyPort ?? defaultWarehouseDependencyPort;

  function assertViewAuthority(actor: GeographyActor | null | undefined): asserts actor is GeographyActor {
    if (!actor) {
      throw forbidden("Authentication required");
    }
    const hasPermission =
      actor.permissions.includes("*") ||
      actor.permissions.includes("warehouses:view") ||
      actor.permissions.includes("warehouses:manage");
    if (!hasPermission) {
      throw forbidden("Permission denied: warehouses:view required");
    }
  }

  function assertManageAuthority(actor: GeographyActor | null | undefined): asserts actor is GeographyActor {
    if (!actor) {
      throw forbidden("Authentication required");
    }
    const hasPermission = actor.permissions.includes("*") || actor.permissions.includes("warehouses:manage");
    if (!hasPermission) {
      throw forbidden("Permission denied: warehouses:manage required");
    }
  }

  return {
    async listAdminWarehouses(
      actor: GeographyActor | null | undefined,
      filter?: ListWarehouseFilter
    ): Promise<WarehouseDTO[]> {
      assertViewAuthority(actor);

      if (filter?.zoneId && !/^[a-fA-F0-9]{24}$/.test(filter.zoneId)) {
        return [];
      }

      let storeFilter: {
        zoneId?: string | undefined;
        isEnabled?: boolean | undefined;
        ids?: readonly string[] | undefined;
      } = {
        zoneId: filter?.zoneId,
        isEnabled: filter?.isEnabled,
      };

      if (!actor.scope.all) {
        if (!actor.scope.warehouseIds || actor.scope.warehouseIds.length === 0) {
          return [];
        }
        storeFilter = {
          ...storeFilter,
          ids: actor.scope.warehouseIds,
        };
      }

      const rows = await deps.warehouseStore.findAll(storeFilter);
      return rows.map((w) => toWarehouseDTO(w));
    },

    async getAdminWarehouse(id: string, actor: GeographyActor | null | undefined): Promise<WarehouseDTO> {
      assertViewAuthority(actor);

      if (!/^[a-fA-F0-9]{24}$/.test(id)) {
        throw notFound("Warehouse");
      }

      const wh = await deps.warehouseStore.findById(id);
      if (!wh) {
        throw notFound("Warehouse");
      }

      // Foreign scope returns 403 per F03 spec
      if (!actor.scope.all && !actor.scope.warehouseIds.includes(wh.id)) {
        throw forbidden("Warehouse outside your scope");
      }

      return toWarehouseDTO(wh);
    },

    async createWarehouse(
      input: CreateWarehouseInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<WarehouseDTO> {
      assertManageAuthority(actor);

      // Warehouse creation requires all-warehouse scope
      if (!actor.scope.all) {
        throw forbidden("Warehouse creation requires all-warehouse scope");
      }

      if (!/^[a-fA-F0-9]{24}$/.test(input.zoneId)) {
        throw notFound("Zone");
      }

      const name = input.name.trim().replace(/\s+/g, " ");
      if (name.length < 1 || name.length > 100) {
        throw validationError("Warehouse name must be between 1 and 100 characters");
      }

      const code = normalizeWarehouseCode(input.code);
      const address = normalizeWarehouseAddress(input.address);
      const location = validateCoordinates(input.location.lat, input.location.lng);

      const priority = input.priority !== undefined ? input.priority : 1;
      if (!Number.isInteger(priority) || priority < 1) {
        throw validationError("Priority must be an integer >= 1");
      }

      const packMinutes = input.packMinutes !== undefined ? input.packMinutes : 5;
      const riderArrivalMinutes = input.riderArrivalMinutes !== undefined ? input.riderArrivalMinutes : 5;
      const defaultTravelMinutes = input.defaultTravelMinutes !== undefined ? input.defaultTravelMinutes : 10;
      const punchInRadiusMeters = input.punchInRadiusMeters !== undefined ? input.punchInRadiusMeters : 150;

      for (const [timerName, val] of [
        ["packMinutes", packMinutes],
        ["riderArrivalMinutes", riderArrivalMinutes],
        ["defaultTravelMinutes", defaultTravelMinutes],
        ["punchInRadiusMeters", punchInRadiusMeters],
      ] as const) {
        if (!Number.isInteger(val) || val < 0) {
          throw validationError(`${timerName} must be a non-negative integer`);
        }
      }

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertManageAuthority(liveActor);
        if (!liveActor.scope.all) {
          throw forbidden("Warehouse creation requires all-warehouse scope");
        }

        // 1. Verify zone exists
        const zone = await deps.zoneStore.findById(input.zoneId, session);
        if (!zone) {
          throw notFound("Zone");
        }

        // 2. Check code uniqueness
        const duplicate = await deps.warehouseStore.findByCode(code, undefined, session);
        if (duplicate) {
          throw conflict("Warehouse code already exists");
        }

        // 3. Create warehouse record
        const id = deps.newId();
        const record: Warehouse = {
          id,
          zoneId: input.zoneId,
          name,
          code,
          location,
          address,
          isEnabled: true,
          priority,
          packMinutes,
          riderArrivalMinutes,
          defaultTravelMinutes,
          punchInRadiusMeters,
          pause: null,
        };

        const created = await deps.warehouseStore.create(record, session);
        const dto = toWarehouseDTO(created);

        return dto;
      });
    },

    async updateWarehouse(
      id: string,
      input: UpdateWarehouseInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<WarehouseDTO> {
      assertManageAuthority(actor);

      if (!/^[a-fA-F0-9]{24}$/.test(id)) {
        throw notFound("Warehouse");
      }

      // Verify scope: actor must have all-scope or target warehouse must be in scope
      if (!actor.scope.all && !actor.scope.warehouseIds.includes(id)) {
        throw forbidden("Warehouse outside your scope");
      }

      // Check pause authority
      if (input.pause !== undefined) {
        const canManageOps = actor.permissions.includes("*") || actor.permissions.includes("ops_mode:manage");
        if (!canManageOps) {
          throw forbidden("Modifying warehouse pause requires ops_mode:manage permission");
        }
      }

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertManageAuthority(liveActor);
        if (!liveActor.scope.all && !liveActor.scope.warehouseIds.includes(id)) {
          throw forbidden("Warehouse outside your scope");
        }
        if (input.pause !== undefined) {
          const canManageOps = liveActor.permissions.includes("*") || liveActor.permissions.includes("ops_mode:manage");
          if (!canManageOps) {
            throw forbidden("Modifying warehouse pause requires ops_mode:manage permission");
          }
        }

        const current = await deps.warehouseStore.findById(id, session);
        if (!current) {
          throw notFound("Warehouse");
        }

        let targetName = current.name;
        if (input.name !== undefined) {
          targetName = input.name.trim().replace(/\s+/g, " ");
          if (targetName.length < 1 || targetName.length > 100) {
            throw validationError("Warehouse name must be between 1 and 100 characters");
          }
        }

        let targetLocation = current.location;
        if (input.location !== undefined) {
          targetLocation = validateCoordinates(input.location.lat, input.location.lng);
        }

        let targetAddress = current.address;
        if (input.address !== undefined) {
          targetAddress = normalizeWarehouseAddress(input.address);
        }

        let targetPriority = current.priority;
        if (input.priority !== undefined) {
          if (!Number.isInteger(input.priority) || input.priority < 1) {
            throw validationError("Priority must be an integer >= 1");
          }
          targetPriority = input.priority;
        }

        let targetPackMinutes = current.packMinutes;
        if (input.packMinutes !== undefined) {
          if (!Number.isInteger(input.packMinutes) || input.packMinutes < 0) {
            throw validationError("packMinutes must be a non-negative integer");
          }
          targetPackMinutes = input.packMinutes;
        }

        let targetRiderArrival = current.riderArrivalMinutes;
        if (input.riderArrivalMinutes !== undefined) {
          if (!Number.isInteger(input.riderArrivalMinutes) || input.riderArrivalMinutes < 0) {
            throw validationError("riderArrivalMinutes must be a non-negative integer");
          }
          targetRiderArrival = input.riderArrivalMinutes;
        }

        let targetDefaultTravel = current.defaultTravelMinutes;
        if (input.defaultTravelMinutes !== undefined) {
          if (!Number.isInteger(input.defaultTravelMinutes) || input.defaultTravelMinutes < 0) {
            throw validationError("defaultTravelMinutes must be a non-negative integer");
          }
          targetDefaultTravel = input.defaultTravelMinutes;
        }

        let targetPunchInRadius = current.punchInRadiusMeters;
        if (input.punchInRadiusMeters !== undefined) {
          if (!Number.isInteger(input.punchInRadiusMeters) || input.punchInRadiusMeters < 0) {
            throw validationError("punchInRadiusMeters must be a non-negative integer");
          }
          targetPunchInRadius = input.punchInRadiusMeters;
        }

        const targetPause = input.pause !== undefined ? input.pause : current.pause;
        const targetIsEnabled = input.isEnabled !== undefined ? input.isEnabled : current.isEnabled;

        // Guarded disable check: if disabling an enabled warehouse
        if (input.isEnabled === false && current.isEnabled) {
          const check = await dependencyPort.checkCanDisable(id, session);
          if (!check.safe) {
            if ("activeOrders" in check && check.activeOrders > 0) {
              throw conflict("Warehouse has active orders", { activeOrders: check.activeOrders });
            }
            throw conflict("Warehouse cannot be disabled: dependency check unavailable", {
              reason: "reason" in check ? check.reason : "dependency_check_unavailable",
            });
          }
        }

        const patch: Partial<Warehouse> = {
          name: targetName,
          location: targetLocation,
          address: targetAddress,
          priority: targetPriority,
          packMinutes: targetPackMinutes,
          riderArrivalMinutes: targetRiderArrival,
          defaultTravelMinutes: targetDefaultTravel,
          punchInRadiusMeters: targetPunchInRadius,
          isEnabled: targetIsEnabled,
          pause: targetPause,
        };

        const updated = await deps.warehouseStore.update(id, patch, session);
        if (!updated) {
          throw notFound("Warehouse");
        }

        const beforeDTO = toWarehouseDTO(current);
        const afterDTO = toWarehouseDTO(updated);

        return afterDTO;
      });
    },
  };
}

export type WarehouseService = ReturnType<typeof createWarehouseService>;
