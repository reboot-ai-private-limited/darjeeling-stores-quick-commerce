import type { GeoLocality, GeoWarehouse, GeoZone, Geography } from "../../../src/platform/geography.js";

export const CITY1 = "e0".repeat(12);
export const LOC1 = "f1".repeat(12);
export const LOC2 = "f2".repeat(12);
export const LOC_OFF = "f3".repeat(12);

interface Ids { ZONE1: string; ZONE2: string; W1: string; W2: string; W3: string }

/**
 * Two zones on a map, three warehouses and a few localities, held in memory. Zone 1 covers latitude 27.00 to 27.10 and zone 2
 * 27.20 to 27.30 (both longitude 88.20 to 88.30). A test can close or pause a warehouse, pause or disable a zone, and so on.
 */
export function createFakeGeography(ids: Ids) {
  const zones = new Map<string, GeoZone>();
  let warehouses: GeoWarehouse[] = [];
  const localities = new Map<string, GeoLocality>();
  const boxes: [string, number, number][] = [[ids.ZONE1, 27.0, 27.1], [ids.ZONE2, 27.2, 27.3]];

  function reset() {
    zones.clear(); localities.clear();
    zones.set(ids.ZONE1, { id: ids.ZONE1, name: "Mall Road & Chowrasta", cityId: CITY1, isEnabled: true, isPaused: false });
    zones.set(ids.ZONE2, { id: ids.ZONE2, name: "Tenzing Norgay Road", cityId: CITY1, isEnabled: true, isPaused: false });
    warehouses = [
      { id: ids.W1, zoneId: ids.ZONE1, isEnabled: true, isOpenNow: true },
      { id: ids.W2, zoneId: ids.ZONE1, isEnabled: true, isOpenNow: true },
      { id: ids.W3, zoneId: ids.ZONE2, isEnabled: true, isOpenNow: true },
    ];
    localities.set(LOC1, { id: LOC1, cityId: CITY1, name: "Chowrasta", location: { lat: 27.041, lng: 88.263 }, zoneId: ids.ZONE1, isActive: true });
    localities.set(LOC2, { id: LOC2, cityId: CITY1, name: "Ghoom", location: { lat: 27.25, lng: 88.25 }, zoneId: ids.ZONE2, isActive: true });
    localities.set(LOC_OFF, { id: LOC_OFF, cityId: CITY1, name: "Closed area", location: { lat: 27.05, lng: 88.25 }, zoneId: null, isActive: false });
  }
  reset();

  const geography: Geography = {
    zone: async id => zones.get(id) ?? null,
    async zoneAt({ lat, lng }) {
      if (lng < 88.2 || lng > 88.3) return null;
      const hit = boxes.find(([, low, high]) => lat >= low && lat <= high);
      const zone = hit ? zones.get(hit[0]) : undefined;
      return zone?.isEnabled ? zone : null;
    },
    warehousesOfZone: async zoneId => warehouses.filter(w => w.zoneId === zoneId).map(w => ({ ...w })),
    locality: async id => localities.get(id) ?? null,
  };

  const warehouse = (id: string) => warehouses.find(w => w.id === id)!;
  return {
    geography, reset,
    zone: (id: string) => zones.get(id)!,
    closeWarehouse(id: string) { warehouse(id).isOpenNow = false; },
    openWarehouse(id: string) { warehouse(id).isOpenNow = true; },
    disableWarehouse(id: string) { warehouse(id).isEnabled = false; },
    pauseZone(id: string) { zones.get(id)!.isPaused = true; },
    disableZone(id: string) { zones.get(id)!.isEnabled = false; },
  };
}
export type FakeGeography = ReturnType<typeof createFakeGeography>;
