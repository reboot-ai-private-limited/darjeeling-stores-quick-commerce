/**
 * Where customers and warehouses are (F03). Dev 1 owns the real implementation (cities, localities, zone polygons, warehouse
 * hours and pauses); Dev 2's discovery and address modules only read through this interface, so they can be built and tested
 * before it exists.
 */
export interface GeoZone { id: string; name: string; cityId: string; isEnabled: boolean; isPaused: boolean }

export interface GeoWarehouse {
  id: string; zoneId: string; name: string; location: { lat: number; lng: number }; isEnabled: boolean;
  /** Taking orders right now: inside its opening hours and not paused. */
  isOpenNow: boolean;
}

export interface GeoLocality {
  id: string; cityId: string; name: string; location: { lat: number; lng: number }; zoneId: string | null; isActive: boolean;
}

export interface Geography {
  zone(zoneId: string): Promise<GeoZone | null>;
  /** The enabled zone containing the point (a point on the border counts as inside), or null when it is outside every zone. */
  zoneAt(point: { lat: number; lng: number }): Promise<GeoZone | null>;
  warehousesOfZone(zoneId: string): Promise<GeoWarehouse[]>;
  warehouse(warehouseId: string): Promise<GeoWarehouse | null>;
  locality(localityId: string): Promise<GeoLocality | null>;
}

/** Until F03 exists there are no zones, so nothing can be browsed or delivered to (a safe default). */
export const noGeography: Geography = {
  zone: async () => null,
  zoneAt: async () => null,
  warehousesOfZone: async () => [],
  warehouse: async () => null,
  locality: async () => null,
};
