export type RiderStatus = "offline" | "online" | "on_break";

export interface Rider {
  id: string; userId: string; name: string; phone: string;
  /** A rider works in one zone, at warehouses of that zone. */
  zoneId: string; warehouseIds: string[]; currentWarehouseId: string | null; vehicle: string | null; photoMediaId: string | null;
  status: RiderStatus; isActive: boolean;
  /** Orders assigned and not yet delivered or failed. Claimed before an assignment is made, so a rider is never over the limit. */
  activeOrderCount: number;
  lastLocation: { lat: number; lng: number } | null; lastLocationAt: Date | null; lastAssignedAt: Date | null;
  currentShiftId: string | null;
  /** Switched to offline by the server because the phone stopped sending its position. */
  autoOffline: boolean;
  appVersion: string | null; pendingSyncCount: number; createdAt: Date; updatedAt: Date;
}

export interface Shift {
  id: string; riderId: string; warehouseId: string; startedAt: Date; endedAt: Date | null;
  /** Where the rider was when punching in; `verified` is false when outside the allowed distance (allowed, but flagged). */
  punchIn: { location: { lat: number; lng: number }; accuracyM: number | null; distanceFromWarehouseM: number; verified: boolean };
  breaks: { from: Date; to: Date | null }[];
  switches: { at: Date; from: string; to: string }[];
  endedBy: "rider" | "admin" | "system" | null;
}

export interface RiderSettings {
  punchInRadiusMeters: number; ackTimeoutSeconds: number; maxActiveOrders: number; deliveryOtpEnabled: boolean;
  locationPingSecondsOnOrder: number; locationPingSecondsIdle: number;
  /** A position older than this does not count as a recent ping when picking a rider. */
  locationStaleSeconds: number;
  /** A rider who is online but silent this long is marked offline. */
  offlineAfterMinutes: number;
}
export const DEFAULT_RIDER_SETTINGS: RiderSettings = {
  punchInRadiusMeters: 150, ackTimeoutSeconds: 120, maxActiveOrders: 2, deliveryOtpEnabled: true,
  locationPingSecondsOnOrder: 10, locationPingSecondsIdle: 60, locationStaleSeconds: 300, offlineAfterMinutes: 10,
};

/** Straight-line distance between two points on the earth, in metres. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** Hours between punching in and out, without breaks, to one decimal place. */
export function hoursWorked(shift: Shift, endedAt: Date): number {
  const breakMs = shift.breaks.reduce((sum, b) => sum + Math.max(0, (b.to ?? endedAt).getTime() - b.from.getTime()), 0);
  const ms = Math.max(0, endedAt.getTime() - shift.startedAt.getTime() - breakMs);
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export const statusOf = (r: Rider): RiderStatus | "deactivated" => (r.isActive ? r.status : "deactivated");

export function riderView(r: Rider) {
  return {
    id: r.id, userId: r.userId, name: r.name, phone: r.phone, zoneId: r.zoneId, warehouseIds: r.warehouseIds, currentWarehouseId: r.currentWarehouseId,
    vehicle: r.vehicle, status: statusOf(r), activeOrderCount: r.activeOrderCount, lastLocation: r.lastLocation, lastLocationAt: r.lastLocationAt?.toISOString() ?? null,
    appVersion: r.appVersion, pendingSyncCount: r.pendingSyncCount, isActive: r.isActive,
  };
}

export function shiftView(s: Shift) {
  return {
    id: s.id, riderId: s.riderId, warehouseId: s.warehouseId, startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null,
    punchIn: { distanceFromWarehouseM: s.punchIn.distanceFromWarehouseM, verified: s.punchIn.verified },
    breaks: s.breaks.map(b => ({ from: b.from.toISOString(), to: b.to?.toISOString() ?? null })), endedBy: s.endedBy,
  };
}
