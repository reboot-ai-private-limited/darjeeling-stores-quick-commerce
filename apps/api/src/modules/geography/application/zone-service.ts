import type { ClientSession } from "mongoose";
import { conflict, forbidden, notFound } from "../domain/errors.js";
import { polygonsOverlap, validatePolygon, type GeoPolygon } from "../domain/geometry.js";
import { zoneOverlap } from "../domain/errors.js";
import { normalizeZoneName, toZoneDTO, type Zone, type ZoneDTO, type ZonePause } from "../domain/zone.js";
import type { CityStore, GeographyActor, LockActorFn, ZoneStore } from "./ports.js";

export interface CreateZoneInput {
  cityId: string;
  name: string;
  polygon: unknown;
  isEnabled?: boolean | undefined;
}

export interface UpdateZoneInput {
  name?: string | undefined;
  polygon?: unknown | undefined;
  isEnabled?: boolean | undefined;
  pause?: ZonePause | null | undefined;
}

export interface ZoneServiceDependencies {
  zoneStore: ZoneStore;
  cityStore: CityStore;
  withTransaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  newId: () => string;
  lockActor?: LockActorFn | undefined;
}

export function createZoneService(deps: ZoneServiceDependencies) {
  function assertZoneAuthority(actor: GeographyActor | null | undefined): asserts actor is GeographyActor {
    if (!actor) {
      throw forbidden("Authentication required");
    }
    const hasPermission = actor.permissions.includes("*") || actor.permissions.includes("zones:manage");
    if (!hasPermission || !actor.scope.all) {
      throw forbidden("Requires zones:manage permission with all-warehouse scope");
    }
  }

  return {
    async listAdminZones(
      actor: GeographyActor | null | undefined,
      filter?: { cityId?: string | undefined }
    ): Promise<ZoneDTO[]> {
      assertZoneAuthority(actor);
      if (filter?.cityId && !/^[a-fA-F0-9]{24}$/.test(filter.cityId)) {
        return [];
      }
      const zones = await deps.zoneStore.findAll(filter);
      return zones.map((z) => toZoneDTO(z));
    },

    async getAdminZone(id: string, actor: GeographyActor | null | undefined): Promise<ZoneDTO | null> {
      assertZoneAuthority(actor);
      if (!/^[a-fA-F0-9]{24}$/.test(id)) return null;
      const zone = await deps.zoneStore.findById(id);
      return zone ? toZoneDTO(zone) : null;
    },

    async createZone(
      input: CreateZoneInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<ZoneDTO> {
      assertZoneAuthority(actor);
      if (!/^[a-fA-F0-9]{24}$/.test(input.cityId)) {
        throw notFound("City");
      }

      const name = normalizeZoneName(input.name);
      const validPolygon: GeoPolygon = validatePolygon(input.polygon);
      const isEnabled = input.isEnabled !== undefined ? input.isEnabled : true;

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertZoneAuthority(liveActor);

        // 1. Verify city exists
        const city = await deps.cityStore.findById(input.cityId, session);
        if (!city) {
          throw notFound("City");
        }

        // 2. Concurrency protocol: serialize all geometry mutations by updating the durable version record
        await deps.zoneStore.serializeGeometry(session);

        // 3. Name uniqueness within city
        const duplicateName = await deps.zoneStore.findByNameInCity(input.cityId, name, undefined, session);
        if (duplicateName) {
          throw conflict("Zone name already exists in this city");
        }

        // 4. If enabled, verify zero positive-area overlap across all enabled zones
        if (isEnabled) {
          const enabledZones = await deps.zoneStore.findEnabled(undefined, session);
          for (const existing of enabledZones) {
            if (polygonsOverlap(validPolygon, existing.polygon)) {
              throw zoneOverlap("Zone overlaps with an existing enabled zone", {
                zoneId: existing.id,
                name: existing.name,
              });
            }
          }
        }

        // 5. Persist the zone
        const id = deps.newId();
        const zoneRecord: Zone = {
          id,
          cityId: input.cityId,
          name,
          polygon: validPolygon,
          isEnabled,
          pause: null,
        };

        const created = await deps.zoneStore.create(zoneRecord, session);
        const dto = toZoneDTO(created);

        return dto;
      });
    },

    async updateZone(
      id: string,
      input: UpdateZoneInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<ZoneDTO> {
      assertZoneAuthority(actor);

      // If modifying pause (setting object or null), require ops_mode:manage
      if (input.pause !== undefined) {
        const canManageOps = actor.permissions.includes("*") || actor.permissions.includes("ops_mode:manage");
        if (!canManageOps) {
          throw forbidden("Modifying zone pause requires ops_mode:manage permission");
        }
      }

      if (!/^[a-fA-F0-9]{24}$/.test(id)) {
        throw notFound("Zone");
      }

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertZoneAuthority(liveActor);
        if (input.pause !== undefined) {
          const canManageOps = liveActor.permissions.includes("*") || liveActor.permissions.includes("ops_mode:manage");
          if (!canManageOps) {
            throw forbidden("Modifying zone pause requires ops_mode:manage permission");
          }
        }

        const current = await deps.zoneStore.findById(id, session);
        if (!current) {
          throw notFound("Zone");
        }

        let newName = current.name;
        if (input.name !== undefined) {
          newName = normalizeZoneName(input.name);
          if (newName !== current.name) {
            const duplicateName = await deps.zoneStore.findByNameInCity(current.cityId, newName, id, session);
            if (duplicateName) {
              throw conflict("Zone name already exists in this city");
            }
          }
        }

        let newPolygon = current.polygon;
        if (input.polygon !== undefined) {
          newPolygon = validatePolygon(input.polygon);
        }

        const newIsEnabled = input.isEnabled !== undefined ? input.isEnabled : current.isEnabled;

        // If zone is enabled, check overlap if polygon changed or if zone was re-enabled
        if (newIsEnabled && (input.polygon !== undefined || (input.isEnabled === true && !current.isEnabled))) {
          await deps.zoneStore.serializeGeometry(session);
          const otherEnabledZones = await deps.zoneStore.findEnabled(id, session);
          for (const existing of otherEnabledZones) {
            if (polygonsOverlap(newPolygon, existing.polygon)) {
              throw zoneOverlap("Zone overlaps with an existing enabled zone", {
                zoneId: existing.id,
                name: existing.name,
              });
            }
          }
        }

        const newPause = input.pause !== undefined ? input.pause : current.pause;

        const patch: Partial<Zone> = {
          name: newName,
          polygon: newPolygon,
          isEnabled: newIsEnabled,
          pause: newPause,
        };

        const updated = await deps.zoneStore.update(id, patch, session);
        if (!updated) {
          throw notFound("Zone");
        }

        const beforeDTO = toZoneDTO(current);
        const afterDTO = toZoneDTO(updated);

        return afterDTO;
      });
    },
  };
}

export type ZoneService = ReturnType<typeof createZoneService>;
