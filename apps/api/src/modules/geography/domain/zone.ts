import type { GeoPolygon } from "./geometry.js";
import { validationError } from "./errors.js";

export interface ZonePause {
  active: boolean;
  message: string;
  until?: string | null | undefined;
}

export interface Zone {
  id: string;
  cityId: string;
  name: string;
  polygon: GeoPolygon;
  isEnabled: boolean;
  pause: ZonePause | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ZoneDTO {
  id: string;
  cityId: string;
  name: string;
  polygon: GeoPolygon;
  isEnabled: boolean;
  pause: ZonePause | null;
}

export function isPauseActive(pause: ZonePause | null | undefined, now = new Date()): boolean {
  if (!pause || !pause.active) return false;
  if (!pause.until) return true;
  const expiry = new Date(pause.until);
  if (isNaN(expiry.getTime())) return false;
  return expiry.getTime() > now.getTime();
}

export function effectivePause(pause: ZonePause | null | undefined, now = new Date()): ZonePause | null {
  if (!pause) return null;
  const active = isPauseActive(pause, now);
  if (!active && pause.active) {
    return { ...pause, active: false };
  }
  return pause;
}

export function normalizeZoneName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw validationError("Zone name must be between 1 and 100 characters");
  }
  return trimmed;
}

export function toZoneDTO(zone: Zone, now = new Date()): ZoneDTO {
  return {
    id: zone.id,
    cityId: zone.cityId,
    name: zone.name,
    polygon: zone.polygon,
    isEnabled: zone.isEnabled,
    pause: effectivePause(zone.pause, now),
  };
}
