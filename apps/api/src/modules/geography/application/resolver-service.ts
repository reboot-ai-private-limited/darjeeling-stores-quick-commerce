import { notFound, validationError } from "../domain/errors.js";
import { isPauseActive } from "../domain/zone.js";
import type { CityStore, LocalityStore, ZoneStore } from "./ports.js";

export interface ResolvedZoneInfo {
  id: string;
  name: string;
  cityId: string;
}

export type ResolutionResult =
  | { deliverable: true; zone: ResolvedZoneInfo }
  | { deliverable: false; paused: true; zone: ResolvedZoneInfo }
  | { deliverable: false };

export interface ResolveLocationInput {
  lat?: number | undefined;
  lng?: number | undefined;
  localityId?: string | undefined;
}

export interface ResolverServiceDependencies {
  zoneStore: ZoneStore;
  cityStore: CityStore;
  localityStore: LocalityStore;
}

export function createResolverService(deps: ResolverServiceDependencies) {
  async function resolvePoint(lat: number, lng: number): Promise<ResolutionResult> {
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw validationError("Latitude must be a finite number between -90 and 90");
    }
    if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw validationError("Longitude must be a finite number between -180 and 180");
    }

    const matchedZones = await deps.zoneStore.findByPoint(lng, lat);
    if (matchedZones.length === 0) {
      return { deliverable: false };
    }

    // Filter to zones belonging to active cities
    const activeCityZones = [];
    for (const zone of matchedZones) {
      const city = await deps.cityStore.findById(zone.cityId);
      if (city && city.isActive) {
        activeCityZones.push(zone);
      }
    }

    if (activeCityZones.length === 0) {
      return { deliverable: false };
    }

    // Border / vertex tie-breaking: lowest hexadecimal zone ObjectId string wins stably
    activeCityZones.sort((a, b) => a.id.localeCompare(b.id));
    const winningZone = activeCityZones[0]!;

    const zoneInfo: ResolvedZoneInfo = {
      id: winningZone.id,
      name: winningZone.name,
      cityId: winningZone.cityId,
    };

    if (isPauseActive(winningZone.pause)) {
      return {
        deliverable: false,
        paused: true,
        zone: zoneInfo,
      };
    }

    return {
      deliverable: true,
      zone: zoneInfo,
    };
  }

  return {
    async resolve(input: ResolveLocationInput): Promise<ResolutionResult> {
      const hasCoords = input.lat !== undefined || input.lng !== undefined;
      const hasLocality = input.localityId !== undefined;

      if (hasCoords && hasLocality) {
        throw validationError("Provide either coordinates (lat, lng) or localityId, not both");
      }
      if (!hasCoords && !hasLocality) {
        throw validationError("Either coordinates (lat, lng) or localityId is required");
      }

      if (hasCoords) {
        if (input.lat === undefined || input.lng === undefined) {
          throw validationError("Both lat and lng coordinates are required");
        }
        return resolvePoint(input.lat, input.lng);
      }

      // Resolving by localityId
      const localityId = input.localityId!;
      if (!/^[a-fA-F0-9]{24}$/.test(localityId)) {
        throw notFound("Locality");
      }

      const locality = await deps.localityStore.findById(localityId);
      if (!locality || !locality.isActive) {
        throw notFound("Locality");
      }

      const city = await deps.cityStore.findById(locality.cityId);
      if (!city || !city.isActive) {
        throw notFound("City");
      }

      // Locality resolution precedence:
      // If locality has an explicit zone link, check that zone:
      // if enabled, resolve to it; if disabled, return { deliverable: false } (does not fall back to point).
      if (locality.zoneId) {
        const zone = await deps.zoneStore.findById(locality.zoneId);
        if (!zone || !zone.isEnabled) {
          return { deliverable: false };
        }

        const zoneInfo: ResolvedZoneInfo = {
          id: zone.id,
          name: zone.name,
          cityId: zone.cityId,
        };

        if (isPauseActive(zone.pause)) {
          return {
            deliverable: false,
            paused: true,
            zone: zoneInfo,
          };
        }

        return {
          deliverable: true,
          zone: zoneInfo,
        };
      }

      // If locality has no explicit zone link, resolve its stored Point location
      return resolvePoint(locality.location.lat, locality.location.lng);
    },
  };
}

export type ResolverService = ReturnType<typeof createResolverService>;
