import type { Geography } from "../../../platform/geography.js";
import type { RiderIdentity } from "../../../platform/identity.js";
import { AppError, assertWarehouseScope, conflict, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { haversineMeters, hoursWorked, riderView, shiftView, type Rider, type RiderSettings, type RiderStatus, type Shift } from "../domain/rider.js";
import { DuplicateRiderError, type AuditEntry, type RiderLoads, type RiderMedia, type RiderStore } from "./ports.js";

export interface RiderInput { name: string; phone: string; zoneId: string; warehouseIds: string[]; vehicle: string | null }
export interface RiderPatch {
  name?: string | undefined; zoneId?: string | undefined; warehouseIds?: string[] | undefined; vehicle?: string | null | undefined; photoMediaId?: string | null | undefined;
}
export interface PunchIn { warehouseId: string; location: { lat: number; lng: number }; accuracyM: number | null }

export interface ShiftQuery { warehouseId?: string | undefined; from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined }
const LIST_LIMIT = 500;
const notAllowed = () => new AppError("FORBIDDEN", "You are not allowed to work at that warehouse", { reason: "warehouse_not_allowed" });

/** Rider profiles, shifts and attendance (F19). */
export function createRiderService(deps: {
  store: RiderStore; geography: Geography; identity: RiderIdentity; media: RiderMedia; loads: RiderLoads; settings: RiderSettings;
  now: () => Date; newId: () => string;
}) {
  const { store, geography, identity, media, loads, settings, now, newId } = deps;

  const auditBase = (ctx: Ctx) => ({ actorId: ctx.actor.userId, actorRole: ctx.actor.role, requestId: ctx.requestId });
  const canSee = (ctx: Ctx, rider: Rider) => ctx.actor.scope.all || rider.warehouseIds.some(w => ctx.actor.scope.warehouseIds.includes(w));
  const scopeOf = (ctx: Ctx) => (ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds);

  async function mine(ctx: Ctx, id: string): Promise<Rider> {
    const rider = await store.get(id);
    if (!rider || !canSee(ctx, rider)) throw notFound("Rider");
    return rider;
  }
  /** Every warehouse must exist and belong to the rider's zone. */
  async function checkPlaces(zoneId: string, warehouseIds: readonly string[]) {
    if (!(await geography.zone(zoneId))) throw notFound("Zone");
    for (const id of warehouseIds) {
      const warehouse = await geography.warehouse(id);
      if (!warehouse) throw notFound("Warehouse");
      if (warehouse.zoneId !== zoneId) throw validation("Every allowed warehouse must be in the rider's zone", { reason: "warehouse_outside_zone", warehouseId: id });
    }
  }
  async function openShift(rider: Rider): Promise<Shift> {
    const shift = rider.currentShiftId ? await store.getShift(rider.currentShiftId) : null;
    if (!shift || shift.endedAt) throw conflict("There is no open shift", { reason: "no_shift" });
    return shift;
  }
  /** Ends the open shift (and any break in it) and takes the rider offline. */
  async function closeShift(rider: Rider, endedBy: "rider" | "admin" | "system", at: Date): Promise<{ shiftId: string; hoursWorked: number } | null> {
    const shift = rider.currentShiftId ? await store.getShift(rider.currentShiftId) : null;
    if (!shift || shift.endedAt) return null;
    const breaks = shift.breaks.map(b => (b.to ? b : { ...b, to: at }));
    await store.updateShift(shift.id, { endedAt: at, endedBy, breaks });
    await store.update(rider.id, { status: "offline", currentShiftId: null, currentWarehouseId: null, autoOffline: false, updatedAt: at });
    return { shiftId: shift.id, hoursWorked: hoursWorked({ ...shift, breaks }, at) };
  }

  async function listShifts(ctx: Ctx, query: ShiftQuery & { riderId?: string | undefined }) {
    if (query.warehouseId) assertWarehouseScope(ctx.actor, query.warehouseId);
    const rows = await store.listShifts({ riderId: query.riderId, warehouseId: query.warehouseId, from: query.from, to: query.to, scope: scopeOf(ctx) }, query.cursor, query.limit + 1);
    const page = rows.slice(0, query.limit);
    return { items: page.map(shiftView), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
  }

  return {
    // ---------- admin ----------
    async list(ctx: Ctx, filters: Omit<Parameters<RiderStore["list"]>[0], "scope">) {
      return (await store.list({ ...filters, scope: scopeOf(ctx) }, LIST_LIMIT)).map(riderView);
    },
    async get(ctx: Ctx, id: string) { return riderView(await mine(ctx, id)); },

    async create(ctx: Ctx, input: RiderInput) {
      for (const id of input.warehouseIds) assertWarehouseScope(ctx.actor, id);
      await checkPlaces(input.zoneId, input.warehouseIds);
      const account = await identity.register({ name: input.name, phone: input.phone });
      if (!account.ok) throw conflict("This phone number already has an account", { field: "phone" });
      const at = now();
      const rider: Rider = {
        id: newId(), userId: account.userId, name: input.name, phone: input.phone, zoneId: input.zoneId, warehouseIds: [...new Set(input.warehouseIds)],
        currentWarehouseId: null, vehicle: input.vehicle, photoMediaId: null, status: "offline", isActive: true, activeOrderCount: 0, lastLocation: null,
        lastLocationAt: null, lastAssignedAt: null, currentShiftId: null, autoOffline: false, appVersion: null, pendingSyncCount: 0, createdAt: at, updatedAt: at,
      };
      try { await store.insert(rider, { ...auditBase(ctx), action: "rider.create", entityType: "rider", entityId: rider.id }); }
      catch (error) {
        if (error instanceof DuplicateRiderError) throw conflict("A rider with this phone number already exists", { field: error.field === "phone" ? "phone" : "userId" });
        throw error;
      }
      return riderView(rider);
    },

    async update(ctx: Ctx, id: string, patch: RiderPatch) {
      const rider = await mine(ctx, id);
      const onShift = rider.currentShiftId !== null;
      const zoneId = patch.zoneId ?? rider.zoneId;
      const warehouseIds = patch.warehouseIds ? [...new Set(patch.warehouseIds)] : rider.warehouseIds;
      if (patch.zoneId !== undefined && patch.zoneId !== rider.zoneId && onShift) throw conflict("A rider on shift cannot change zone", { reason: "on_shift" });
      if (onShift && rider.currentWarehouseId && !warehouseIds.includes(rider.currentWarehouseId)) throw conflict("The rider is working at a warehouse you are removing", { reason: "current_warehouse" });
      for (const w of warehouseIds) assertWarehouseScope(ctx.actor, w);
      if (patch.zoneId !== undefined || patch.warehouseIds !== undefined) await checkPlaces(zoneId, warehouseIds);

      const next: Partial<Rider> = { zoneId, warehouseIds, updatedAt: now() };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.vehicle !== undefined) next.vehicle = patch.vehicle;
      let replaced: string | null = null;
      let claimed: string | null = null;
      if (patch.photoMediaId !== undefined && patch.photoMediaId !== rider.photoMediaId) {
        if (patch.photoMediaId !== null) { await media.claim({ mediaId: patch.photoMediaId, userId: ctx.actor.userId, riderId: id }); claimed = patch.photoMediaId; }
        next.photoMediaId = patch.photoMediaId;
        replaced = rider.photoMediaId;
      }
      try { await store.update(id, next, undefined, { ...auditBase(ctx), action: "rider.update", entityType: "rider", entityId: id }); }
      catch (error) { if (claimed) await media.release(claimed, "rider_not_saved").catch(() => undefined); throw error; }
      if (patch.name !== undefined && patch.name !== rider.name) await identity.rename(rider.userId, patch.name);
      if (replaced) await media.release(replaced, "rider_photo_replaced").catch(() => undefined);
      return riderView((await store.get(id))!);
    },

    async deactivate(ctx: Ctx, id: string) {
      const rider = await mine(ctx, id);
      await identity.setActive(rider.userId, false);
      const at = now();
      await closeShift(rider, "admin", at);
      await store.update(id, { isActive: false, status: "offline", updatedAt: at }, undefined, { ...auditBase(ctx), action: "rider.deactivate", entityType: "rider", entityId: id });
      return riderView((await store.get(id))!);
    },

    async reactivate(ctx: Ctx, id: string) {
      const rider = await mine(ctx, id);
      await identity.setActive(rider.userId, true);
      await store.update(id, { isActive: true, updatedAt: now() }, undefined, { ...auditBase(ctx), action: "rider.reactivate", entityType: "rider", entityId: id });
      return riderView((await store.get(id))!);
    },

    /** Ends the rider's shift. Refused while goods are in the rider's hands, unless forced. */
    async forceOffline(ctx: Ctx, id: string, force: boolean) {
      const rider = await mine(ctx, id);
      if (!force && (await loads.pickedUpCount(id)) > 0) throw conflict("The rider is carrying orders; hand them over first, or force it", { reason: "picked_up_orders" });
      await closeShift(rider, "admin", now());
      await store.recordAudit({ ...auditBase(ctx), action: "rider.force_offline", entityType: "rider", entityId: id });
      return riderView((await store.get(id))!);
    },

    async shiftsOf(ctx: Ctx, riderId: string, query: ShiftQuery) { await mine(ctx, riderId); return listShifts(ctx, { ...query, riderId }); },
    shifts: listShifts,

    // ---------- the rider ----------
    async me(rider: Rider) {
      const warehouses = (await Promise.all(rider.warehouseIds.map(id => geography.warehouse(id)))).flatMap(w => (w ? [{ id: w.id, name: w.name, location: w.location }] : []));
      const shift = rider.currentShiftId ? await store.getShift(rider.currentShiftId) : null;
      return {
        riderId: rider.id, name: rider.name, phone: rider.phone, photo: rider.photoMediaId ? { mediaId: rider.photoMediaId } : null, zoneId: rider.zoneId, warehouses,
        status: rider.status, currentWarehouseId: rider.currentWarehouseId,
        currentShift: shift && !shift.endedAt ? { id: shift.id, startedAt: shift.startedAt.toISOString(), warehouseId: shift.warehouseId } : null,
        activeOrderCount: rider.activeOrderCount, pendingSyncCount: rider.pendingSyncCount,
        settings: {
          locationPingSecondsOnOrder: settings.locationPingSecondsOnOrder, locationPingSecondsIdle: settings.locationPingSecondsIdle,
          ackTimeoutSeconds: settings.ackTimeoutSeconds, deliveryOtpEnabled: settings.deliveryOtpEnabled, maxActiveOrders: settings.maxActiveOrders,
        },
      };
    },

    async startShift(rider: Rider, input: PunchIn) {
      if (!rider.warehouseIds.includes(input.warehouseId)) throw notAllowed();
      const warehouse = await geography.warehouse(input.warehouseId);
      if (!warehouse || !warehouse.isEnabled) throw notFound("Warehouse");
      const at = now();
      const distance = haversineMeters(input.location, warehouse.location);
      const verified = distance <= settings.punchInRadiusMeters;
      const shiftId = newId();
      const claimed = await store.claimShift(rider.id, shiftId, {
        status: "online", currentWarehouseId: warehouse.id, lastLocation: input.location, lastLocationAt: at, autoOffline: false, updatedAt: at,
      });
      if (!claimed) throw conflict("A shift is already open", { reason: "shift_open" });
      try {
        await store.insertShift({
          id: shiftId, riderId: rider.id, warehouseId: warehouse.id, startedAt: at, endedAt: null, breaks: [], switches: [], endedBy: null,
          punchIn: { location: input.location, accuracyM: input.accuracyM, distanceFromWarehouseM: distance, verified },
        });
      } catch (error) {
        await store.update(rider.id, { status: "offline", currentShiftId: null, currentWarehouseId: null, updatedAt: at });
        throw error;
      }
      return { shiftId, status: "online" as const, punchIn: { distanceFromWarehouseM: distance, verified }, currentWarehouseId: warehouse.id };
    },

    async switchWarehouse(rider: Rider, warehouseId: string) {
      const shift = await openShift(rider);
      if (!rider.warehouseIds.includes(warehouseId)) throw notAllowed();
      const warehouse = await geography.warehouse(warehouseId);
      if (!warehouse || !warehouse.isEnabled) throw notFound("Warehouse");
      const at = now();
      if (warehouseId !== rider.currentWarehouseId) {
        await store.updateShift(shift.id, { switches: [...shift.switches, { at, from: rider.currentWarehouseId ?? shift.warehouseId, to: warehouseId }] });
        await store.update(rider.id, { currentWarehouseId: warehouseId, updatedAt: at });
      }
      return { currentWarehouseId: warehouseId };
    },

    async startBreak(rider: Rider) {
      const shift = await openShift(rider);
      if (rider.status === "on_break") throw conflict("Already on a break", { reason: "on_break" });
      const at = now();
      if (!(await store.update(rider.id, { status: "on_break", updatedAt: at }, { currentShiftId: shift.id }))) throw conflict("The shift changed; try again", { reason: "no_shift" });
      await store.updateShift(shift.id, { breaks: [...shift.breaks, { from: at, to: null }] });
      return { status: "on_break" as RiderStatus };
    },

    async resume(rider: Rider) {
      const shift = await openShift(rider);
      if (rider.status !== "on_break") throw conflict("Not on a break", { reason: "not_on_break" });
      const at = now();
      await store.updateShift(shift.id, { breaks: shift.breaks.map(b => (b.to ? b : { ...b, to: at })) });
      await store.update(rider.id, { status: "online", updatedAt: at }, { currentShiftId: shift.id });
      return { status: "online" as RiderStatus };
    },

    /** Punching out is refused while the rider has orders or unsent offline events; an admin can force it. */
    async endShift(rider: Rider) {
      await openShift(rider);
      if (rider.activeOrderCount > 0) throw conflict("Finish your deliveries first", { reason: "active_orders" });
      if (rider.pendingSyncCount > 0) throw conflict("Sync your offline deliveries first", { reason: "unsynced_events" });
      const ended = await closeShift(rider, "rider", now());
      if (!ended) throw conflict("There is no open shift", { reason: "no_shift" });
      return ended;
    },

    async setPhoto(rider: Rider, mediaId: string) {
      if (mediaId === rider.photoMediaId) return;
      await media.claim({ mediaId, userId: rider.userId, riderId: rider.id });
      try { await store.update(rider.id, { photoMediaId: mediaId, updatedAt: now() }); }
      catch (error) { await media.release(mediaId, "rider_not_saved").catch(() => undefined); throw error; }
      if (rider.photoMediaId) await media.release(rider.photoMediaId, "rider_photo_replaced").catch(() => undefined);
    },

    // ---------- for dispatch and tracking ----------
    forUser: (userId: string) => store.getByUserId(userId),
    byId: (id: string) => store.get(id),
    getMany: (ids: readonly string[]) => store.getMany(ids),
    listActive: () => store.listActive(),
    reserveCapacity: (riderId: string, max: number) => store.reserveCapacity(riderId, max),
    releaseCapacity: (riderId: string) => store.releaseCapacity(riderId),
    markAssigned: (riderId: string, at: Date) => store.update(riderId, { lastAssignedAt: at, updatedAt: at }),

    /** A position from the rider's phone. It also brings back a rider the server had marked offline for being silent. */
    async recordLocation(riderId: string, location: { lat: number; lng: number }, at: Date): Promise<boolean> {
      const rider = await store.get(riderId);
      if (!rider) return false;
      // A buffered point from a dead spot never replaces a newer position.
      if (rider.lastLocationAt && at.getTime() <= rider.lastLocationAt.getTime()) return false;
      const back = rider.autoOffline && rider.currentShiftId !== null;
      await store.update(riderId, { lastLocation: location, lastLocationAt: at, updatedAt: at, ...(back && { status: "online" as const, autoOffline: false }) });
      return true;
    },

    /** A rider on shift whose phone has gone quiet is marked offline; returns who, so dispatch can raise an alert. */
    async sweepSilent(): Promise<Rider[]> {
      const at = now();
      return store.markStaleOffline(new Date(at.getTime() - settings.offlineAfterMinutes * 60_000), at);
    },
  };
}

export type RiderService = ReturnType<typeof createRiderService>;
