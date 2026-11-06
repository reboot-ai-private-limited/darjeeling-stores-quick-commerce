import type { LatLngPoint } from "./geometry.js";
import { validationError } from "./errors.js";

export interface Locality {
  id: string;
  cityId: string;
  name: string;
  location: LatLngPoint;
  zoneId: string | null;
  travelMinutes: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LocalityDTO {
  id: string;
  cityId: string;
  name: string;
  location: LatLngPoint;
  zoneId: string | null;
  travelMinutes: number | null;
  sortOrder: number;
  isActive: boolean;
}

export function normalizeLocalityName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw validationError("Locality name must be between 1 and 100 characters");
  }
  return trimmed;
}

export function validateCoordinates(lat: number, lng: number): LatLngPoint {
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw validationError("Latitude must be a finite number between -90 and 90");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw validationError("Longitude must be a finite number between -180 and 180");
  }
  return { lat, lng };
}

export function toLocalityDTO(loc: Locality): LocalityDTO {
  return {
    id: loc.id,
    cityId: loc.cityId,
    name: loc.name,
    location: {
      lat: loc.location.lat,
      lng: loc.location.lng,
    },
    zoneId: loc.zoneId,
    travelMinutes: loc.travelMinutes,
    sortOrder: loc.sortOrder,
    isActive: loc.isActive,
  };
}
