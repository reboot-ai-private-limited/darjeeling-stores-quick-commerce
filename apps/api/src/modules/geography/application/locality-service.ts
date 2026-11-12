import type { ClientSession } from "mongoose";
import { conflict, forbidden, notFound, validationError } from "../domain/errors.js";
import type { LatLngPoint } from "../domain/geometry.js";
import {
  normalizeLocalityName,
  toLocalityDTO,
  validateCoordinates,
  type Locality,
  type LocalityDTO,
} from "../domain/locality.js";
import type { CityStore, GeographyActor, LocalityStore, LockActorFn, ZoneStore } from "./ports.js";

export interface CreateLocalityInput {
  cityId: string;
  name: string;
  location: LatLngPoint;
  zoneId?: string | null | undefined;
  travelMinutes?: number | null | undefined;
  sortOrder?: number | undefined;
}

export interface UpdateLocalityInput {
  name?: string | undefined;
  cityId?: string | undefined;
  location?: LatLngPoint | undefined;
  zoneId?: string | null | undefined;
  travelMinutes?: number | null | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

export interface LocalityServiceDependencies {
  localityStore: LocalityStore;
  cityStore: CityStore;
  zoneStore: ZoneStore;
  withTransaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  newId: () => string;
  lockActor?: LockActorFn | undefined;
}

export function createLocalityService(deps: LocalityServiceDependencies) {
  function assertLocalityAuthority(actor: GeographyActor | null | undefined): asserts actor is GeographyActor {
    if (!actor) {
      throw forbidden("Authentication required");
    }
    const hasPermission = actor.permissions.includes("*") || actor.permissions.includes("zones:manage");
    if (!hasPermission || !actor.scope.all) {
      throw forbidden("Requires zones:manage permission with all-warehouse scope");
    }
  }

  return {
    async listPublicLocalities(cityId: string): Promise<LocalityDTO[]> {
      if (!/^[a-fA-F0-9]{24}$/.test(cityId)) {
        throw notFound("City");
      }
      const city = await deps.cityStore.findById(cityId);
      if (!city || !city.isActive) {
        throw notFound("City");
      }
      const localities = await deps.localityStore.findActiveByCity(cityId);
      return localities.map(toLocalityDTO);
    },

    async listAdminLocalities(
      actor: GeographyActor | null | undefined,
      filter?: { cityId?: string | undefined }
    ): Promise<LocalityDTO[]> {
      assertLocalityAuthority(actor);
      if (filter?.cityId && !/^[a-fA-F0-9]{24}$/.test(filter.cityId)) {
        return [];
      }
      const localities = await deps.localityStore.findAll(filter);
      return localities.map(toLocalityDTO);
    },

    async getLocalityById(id: string): Promise<LocalityDTO | null> {
      if (!/^[a-fA-F0-9]{24}$/.test(id)) return null;
      const locality = await deps.localityStore.findById(id);
      return locality ? toLocalityDTO(locality) : null;
    },

    async createLocality(
      input: CreateLocalityInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<LocalityDTO> {
      assertLocalityAuthority(actor);
      if (!/^[a-fA-F0-9]{24}$/.test(input.cityId)) {
        throw notFound("City");
      }
      if (input.zoneId && !/^[a-fA-F0-9]{24}$/.test(input.zoneId)) {
        throw notFound("Zone");
      }

      const name = normalizeLocalityName(input.name);
      const location = validateCoordinates(input.location.lat, input.location.lng);

      if (input.travelMinutes !== undefined && input.travelMinutes !== null) {
        if (!Number.isInteger(input.travelMinutes) || input.travelMinutes < 0) {
          throw validationError("Travel minutes must be a non-negative integer");
        }
      }

      if (input.sortOrder !== undefined) {
        if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
          throw validationError("Sort order must be a non-negative integer");
        }
      }

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertLocalityAuthority(liveActor);

        // 1. Verify parent city exists
        const city = await deps.cityStore.findById(input.cityId, session);
        if (!city) {
          throw notFound("City");
        }

        // 2. Check name uniqueness in city
        const duplicate = await deps.localityStore.findByNameInCity(input.cityId, name, undefined, session);
        if (duplicate) {
          throw conflict("Locality name already exists in this city");
        }

        // 3. If zoneId provided, verify zone exists and belongs to the same city
        if (input.zoneId) {
          const zone = await deps.zoneStore.findById(input.zoneId, session);
          if (!zone) {
            throw notFound("Zone");
          }
          if (zone.cityId !== input.cityId) {
            throw conflict("Zone does not belong to the selected city");
          }
        }

        // 4. Create record
        const id = deps.newId();
        const record: Locality = {
          id,
          cityId: input.cityId,
          name,
          location,
          zoneId: input.zoneId ?? null,
          travelMinutes: input.travelMinutes ?? null,
          sortOrder: input.sortOrder ?? 0,
          isActive: true,
        };

        const created = await deps.localityStore.create(record, session);
        const dto = toLocalityDTO(created);

        return dto;
      });
    },

    async updateLocality(
      id: string,
      input: UpdateLocalityInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<LocalityDTO> {
      assertLocalityAuthority(actor);
      if (!/^[a-fA-F0-9]{24}$/.test(id)) {
        throw notFound("Locality");
      }

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertLocalityAuthority(liveActor);

        const current = await deps.localityStore.findById(id, session);
        if (!current) {
          throw notFound("Locality");
        }

        const targetCityId = input.cityId !== undefined ? input.cityId : current.cityId;
        if (!/^[a-fA-F0-9]{24}$/.test(targetCityId)) {
          throw notFound("City");
        }

        if (input.cityId !== undefined && input.cityId !== current.cityId) {
          const city = await deps.cityStore.findById(targetCityId, session);
          if (!city) {
            throw notFound("City");
          }
        }

        let targetName = current.name;
        if (input.name !== undefined) {
          targetName = normalizeLocalityName(input.name);
        }

        if (input.name !== undefined || input.cityId !== undefined) {
          const duplicate = await deps.localityStore.findByNameInCity(targetCityId, targetName, id, session);
          if (duplicate) {
            throw conflict("Locality name already exists in this city");
          }
        }

        let targetLocation = current.location;
        if (input.location !== undefined) {
          targetLocation = validateCoordinates(input.location.lat, input.location.lng);
        }

        let targetZoneId = current.zoneId;
        if (input.zoneId !== undefined) {
          targetZoneId = input.zoneId;
        }

        if (targetZoneId !== null) {
          if (!/^[a-fA-F0-9]{24}$/.test(targetZoneId)) {
            throw notFound("Zone");
          }
          const zone = await deps.zoneStore.findById(targetZoneId, session);
          if (!zone) {
            throw notFound("Zone");
          }
          if (zone.cityId !== targetCityId) {
            throw conflict("Zone does not belong to the locality's city");
          }
        }

        let targetTravelMinutes = current.travelMinutes;
        if (input.travelMinutes !== undefined) {
          if (input.travelMinutes !== null && (!Number.isInteger(input.travelMinutes) || input.travelMinutes < 0)) {
            throw validationError("Travel minutes must be a non-negative integer");
          }
          targetTravelMinutes = input.travelMinutes;
        }

        let targetSortOrder = current.sortOrder;
        if (input.sortOrder !== undefined) {
          if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
            throw validationError("Sort order must be a non-negative integer");
          }
          targetSortOrder = input.sortOrder;
        }

        const targetIsActive = input.isActive !== undefined ? input.isActive : current.isActive;

        const patch: Partial<Locality> = {
          cityId: targetCityId,
          name: targetName,
          location: targetLocation,
          zoneId: targetZoneId,
          travelMinutes: targetTravelMinutes,
          sortOrder: targetSortOrder,
          isActive: targetIsActive,
        };

        const updated = await deps.localityStore.update(id, patch, session);
        if (!updated) {
          throw notFound("Locality");
        }

        const beforeDTO = toLocalityDTO(current);
        const afterDTO = toLocalityDTO(updated);

        return afterDTO;
      });
    },
  };
}

export type LocalityService = ReturnType<typeof createLocalityService>;
