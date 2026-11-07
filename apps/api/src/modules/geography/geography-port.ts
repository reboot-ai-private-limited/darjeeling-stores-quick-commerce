import type { GeoLocality, GeoWarehouse, GeoZone, Geography } from "../../platform/geography.js";
import type { createResolverService } from "./application/resolver-service.js";
import type { LocalityStore, WarehouseStore, ZoneStore } from "./application/ports.js";
import { isPauseActive } from "./domain/zone.js";

const ID = /^[a-fA-F0-9]{24}$/;

/**
 * The `Geography` port the catalog, address, cart, order and delivery modules use, answered from the real cities, zones, localities
 * and warehouses. A warehouse here is "open" when it is enabled and not paused; the hours module narrows that further with opening hours.
 */
export function createGeographyPort(stores: {
  zoneStore: ZoneStore; warehouseStore: WarehouseStore; localityStore: LocalityStore; resolverService: ReturnType<typeof createResolverService>;
}): Geography {
  const toZone = (z: { id: string; name: string; cityId: string; isEnabled: boolean; pause: Parameters<typeof isPauseActive>[0] }): GeoZone =>
    ({ id: z.id, name: z.name, cityId: z.cityId, isEnabled: z.isEnabled, isPaused: isPauseActive(z.pause) });
  const toWarehouse = (w: { id: string; zoneId: string; name: string; location: { lat: number; lng: number }; isEnabled: boolean; pause: Parameters<typeof isPauseActive>[0] }): GeoWarehouse =>
    ({ id: w.id, zoneId: w.zoneId, name: w.name, location: { lat: w.location.lat, lng: w.location.lng }, isEnabled: w.isEnabled, isOpenNow: w.isEnabled && !isPauseActive(w.pause) });

  return {
    async zone(zoneId) { if (!ID.test(zoneId)) return null; const z = await stores.zoneStore.findById(zoneId); return z ? toZone(z) : null; },

    async zoneAt(point) {
      const found = await stores.resolverService.resolve({ lat: point.lat, lng: point.lng });
      if (!found.deliverable && !("paused" in found)) return null;
      const zone = await this.zone(found.zone.id);
      return zone && zone.isEnabled ? zone : null;
    },

    async warehousesOfZone(zoneId) {
      if (!ID.test(zoneId)) return [];
      return (await stores.warehouseStore.findAll({ zoneId })).map(toWarehouse);
    },

    async warehouse(warehouseId) { if (!ID.test(warehouseId)) return null; const w = await stores.warehouseStore.findById(warehouseId); return w ? toWarehouse(w) : null; },

    async locality(localityId): Promise<GeoLocality | null> {
      if (!ID.test(localityId)) return null;
      const l = await stores.localityStore.findById(localityId);
      return l ? { id: l.id, cityId: l.cityId, name: l.name, location: { lat: l.location.lat, lng: l.location.lng }, zoneId: l.zoneId, isActive: l.isActive } : null;
    },
  };
}
