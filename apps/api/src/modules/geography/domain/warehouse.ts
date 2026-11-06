import type { LatLngPoint } from "./geometry.js";
import type { ZonePause } from "./zone.js";
import { effectivePause } from "./zone.js";
import { validationError } from "./errors.js";

export interface Warehouse {
  id: string;
  zoneId: string;
  name: string;
  code: string;
  location: LatLngPoint;
  address: string;
  isEnabled: boolean;
  priority: number;
  packMinutes: number;
  riderArrivalMinutes: number;
  defaultTravelMinutes: number;
  punchInRadiusMeters: number;
  pause: ZonePause | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WarehouseDTO {
  id: string;
  zoneId: string;
  name: string;
  code: string;
  location: LatLngPoint;
  address: string;
  isEnabled: boolean;
  priority: number;
  packMinutes: number;
  riderArrivalMinutes: number;
  defaultTravelMinutes: number;
  punchInRadiusMeters: number;
  pause: ZonePause | null;
}

export function normalizeWarehouseCode(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(upper)) {
    throw validationError("Warehouse code must be 2-20 uppercase alphanumeric characters or hyphens");
  }
  return upper;
}

export function normalizeWarehouseAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    throw validationError("Warehouse address must be between 3 and 500 characters");
  }
  return trimmed;
}

export function toWarehouseDTO(wh: Warehouse, now = new Date()): WarehouseDTO {
  return {
    id: wh.id,
    zoneId: wh.zoneId,
    name: wh.name,
    code: wh.code,
    location: {
      lat: wh.location.lat,
      lng: wh.location.lng,
    },
    address: wh.address,
    isEnabled: wh.isEnabled,
    priority: wh.priority,
    packMinutes: wh.packMinutes,
    riderArrivalMinutes: wh.riderArrivalMinutes,
    defaultTravelMinutes: wh.defaultTravelMinutes,
    punchInRadiusMeters: wh.punchInRadiusMeters,
    pause: effectivePause(wh.pause, now),
  };
}
