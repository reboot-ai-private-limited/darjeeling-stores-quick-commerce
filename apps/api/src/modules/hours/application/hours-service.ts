import type { GeoWarehouse, Geography } from "../../../platform/geography.js";
import { AppError, assertWarehouseScope, conflict, forbidden, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import {
  DEFAULT_PREORDER, hoursProblem, hoursView, isOpen, istDate, istInstant, istIso, matchSlot, nextOpening, onOfferedDay, pauseActive, slotsProblem, upcomingSlots,
  type HoursRule, type Pause, type PreOrderConfig, type Slot, type WarehouseHours,
} from "../domain/hours.js";
import { SlotFullError, type HoursStore, type PreorderSource } from "./ports.js";

export interface HoursDeps { store: HoursStore; geography: Geography; preorders: PreorderSource; now: () => Date }
export interface ClosedReason { code: "STORE_CLOSED" | "ZONE_PAUSED"; message: string; opensAt: Date | null; until: Date | null; preOrderAvailable: boolean }

const audit = (ctx: Ctx, action: string, entityType: string, entityId: string, warehouseId?: string) =>
  ({ actorId: ctx.actor.userId, actorRole: ctx.actor.role, requestId: ctx.requestId, action, entityType, entityId, ...(warehouseId && { warehouseId }) });

/** When a warehouse takes orders, the next-morning pre-order slots, and the pause switch (F17). */
export function createHoursService(deps: HoursDeps) {
  const { store, geography, preorders, now } = deps;

  async function zoneState(zoneId: string, at: Date) {
    const warehouses = (await geography.warehousesOfZone(zoneId)).filter(w => w.isEnabled);
    const ids = warehouses.map(w => w.id);
    const [configs, pauses, zonePause] = await Promise.all([store.getManyHours(ids), store.getPauses("warehouse", ids), store.getPause("zone", zoneId)]);
    const cfg = new Map(configs.map(c => [c.warehouseId, c]));
    const paused = new Map(pauses.filter(p => pauseActive(p, at)).map(p => [p.id, p]));
    const zp = pauseActive(zonePause, at) ? zonePause : null;
    const rows = warehouses.map(w => {
      const c = cfg.get(w.id) ?? null;
      const pause = zp ?? paused.get(w.id) ?? null;
      return { warehouse: w, config: c, pause, open: !pause && (c ? isOpenConfigured(c, at) : w.isOpenNow) };
    });
    return { rows, zonePause: zp };
  }
  const isOpenConfigured = (c: WarehouseHours, at: Date) => isOpen(c, at);

  async function closedReason(zoneId: string, at = now()): Promise<ClosedReason | null> {
    const { rows, zonePause } = await zoneState(zoneId, at);
    // A zone paused in the geography settings (F03) counts too.
    if ((await geography.zone(zoneId))?.isPaused && !zonePause) return { code: "ZONE_PAUSED", message: "Deliveries are paused in this area for now", opensAt: null, until: null, preOrderAvailable: false };
    if (rows.some(r => r.open)) return null;
    if (zonePause) return { code: "ZONE_PAUSED", message: zonePause.message ?? "Deliveries are paused in this area for now", opensAt: null, until: zonePause.until, preOrderAvailable: false };
    const pausedRow = rows.find(r => r.pause);
    if (rows.length > 0 && rows.every(r => r.pause)) {
      return { code: "ZONE_PAUSED", message: pausedRow!.pause!.message ?? "Deliveries are paused in this area for now", opensAt: null, until: pausedRow!.pause!.until, preOrderAvailable: false };
    }
    const opens = rows.flatMap(r => (r.config && !r.pause ? [nextOpening(r.config, at)] : [])).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime());
    const preOrderAvailable = rows.some(r => !r.pause && r.config?.afterHoursMode === "pre_order" && r.config.preOrder.enabled && upcomingSlots(r.config.preOrder, at).length > 0);
    return { code: "STORE_CLOSED", message: "We are closed right now", opensAt: opens[0] ?? null, until: null, preOrderAvailable };
  }

  async function assertZone(ctx: Ctx, zoneId: string): Promise<void> {
    if (!(await geography.zone(zoneId))) throw notFound("Zone");
    if (!ctx.actor.scope.all) {
      const warehouses = await geography.warehousesOfZone(zoneId);
      if (warehouses.length === 0 || warehouses.some(w => !ctx.actor.scope.warehouseIds.includes(w.id))) throw forbidden("This zone is outside your scope");
    }
  }
  async function warehouseOf(ctx: Ctx, id: string): Promise<GeoWarehouse> {
    const w = await geography.warehouse(id);
    if (!w) throw notFound("Warehouse");
    assertWarehouseScope(ctx.actor, id);
    return w;
  }

  /** Warehouses that can supply a pre-order window, or an error saying why not. */
  async function forWindow(zoneId: string, window: { start: Date; end: Date }, at = now()): Promise<string[]> {
    const reason = await closedReason(zoneId, at);
    if (reason?.code === "ZONE_PAUSED") throw new AppError("ZONE_PAUSED", reason.message, { message: reason.message, until: reason.until?.toISOString() ?? null });
    if (!reason) throw validation("Pre-orders are only for when we are closed", { field: "scheduledWindow" });
    if (!onOfferedDay(window, at)) throw validation("That time slot is not available", { field: "scheduledWindow" });
    const { rows } = await zoneState(zoneId, at);
    const matches = rows.flatMap(r => {
      if (r.pause || !r.config || r.config.afterHoursMode !== "pre_order" || !r.config.preOrder.enabled) return [];
      const m = matchSlot(r.config.preOrder, window);
      return m ? [{ id: r.warehouse.id, ...m }] : [];
    });
    if (matches.length === 0) throw validation("That time slot is not available", { field: "scheduledWindow" });
    const open = matches.filter(m => m.cutoffAt.getTime() > at.getTime());
    if (open.length === 0) throw conflict("The booking time for that slot has passed", { reason: "cutoff_passed" });
    const withRoom: string[] = [];
    for (const m of open) {
      const taken = (await store.booked(m.id, m.date)).get(m.slot.start) ?? 0;
      if (taken < m.slot.capacity) withRoom.push(m.id);
    }
    if (withRoom.length === 0) throw conflict("That slot is full", { reason: "slot_full" });
    return withRoom;
  }

  return {
    closedReason, forWindow,

    /** Wraps the geography port so a warehouse is open only inside its hours and not paused, and a zone is paused when staff paused it. */
    decorate(base: Geography): Geography {
      const adjust = async (w: GeoWarehouse): Promise<GeoWarehouse> => {
        const at = now();
        const [cfg, wp, zp] = await Promise.all([store.getHours(w.id), store.getPause("warehouse", w.id), store.getPause("zone", w.zoneId)]);
        const paused = pauseActive(wp, at) || pauseActive(zp, at);
        return { ...w, isOpenNow: !paused && (cfg ? isOpenConfigured(cfg, at) : w.isOpenNow) };
      };
      return {
        ...base,
        zone: async id => { const z = await base.zone(id); return z && { ...z, isPaused: z.isPaused || pauseActive(await store.getPause("zone", id), now()) }; },
        warehousesOfZone: async zoneId => Promise.all((await base.warehousesOfZone(zoneId)).map(adjust)),
        warehouse: async id => { const w = await base.warehouse(id); return w && adjust(w); },
      };
    },

    async getHours(ctx: Ctx, warehouseId: string) { await warehouseOf(ctx, warehouseId); const h = await store.getHours(warehouseId); return h ? hoursView(h) : null; },

    async setHours(ctx: Ctx, warehouseId: string, input: { hours: HoursRule[]; lastOrderMinutesBeforeClose: number; afterHoursMode: "closed" | "pre_order" }) {
      await warehouseOf(ctx, warehouseId);
      const problem = hoursProblem(input.hours);
      if (problem) throw validation(problem, { field: "hours" });
      const current = await store.getHours(warehouseId);
      const next: WarehouseHours = { warehouseId, ...input, preOrder: current?.preOrder ?? DEFAULT_PREORDER, updatedAt: now() };
      await store.saveHours(next, audit(ctx, "hours.set_hours", "warehouse", warehouseId, warehouseId));
      return hoursView(next);
    },

    async setPreorder(ctx: Ctx, warehouseId: string, input: { enabled: boolean; slots: Slot[]; cutoffMinutesBeforeSlot: number; packLeadMinutes: number }) {
      await warehouseOf(ctx, warehouseId);
      const problem = slotsProblem(input.slots);
      if (problem) throw validation(problem, { field: "slots" });
      if (input.enabled && input.slots.length === 0) throw validation("Add at least one slot to turn pre-orders on", { field: "slots" });
      const current = await store.getHours(warehouseId);
      const preOrder: PreOrderConfig = { ...input };
      const next: WarehouseHours = current
        ? { ...current, preOrder, updatedAt: now() }
        : { warehouseId, hours: [], lastOrderMinutesBeforeClose: 15, afterHoursMode: "closed", preOrder, updatedAt: now() };
      await store.saveHours(next, audit(ctx, "hours.set_preorder", "warehouse", warehouseId, warehouseId));
      return hoursView(next);
    },

    async pause(ctx: Ctx, input: { scope: "warehouse" | "zone"; id: string; message: string | null; until: Date | null }) {
      if (input.scope === "warehouse") await warehouseOf(ctx, input.id); else await assertZone(ctx, input.id);
      if (input.until && input.until.getTime() <= now().getTime()) throw validation("The end time must be in the future", { field: "until" });
      const pause: Pause = { scope: input.scope, id: input.id, active: true, message: input.message, until: input.until, by: ctx.actor.userId, at: now() };
      await store.savePause(pause, audit(ctx, "hours.pause", input.scope, input.id));
      return { scope: input.scope, id: input.id, pause: { active: true, message: pause.message, until: pause.until?.toISOString() ?? null } };
    },
    async resume(ctx: Ctx, input: { scope: "warehouse" | "zone"; id: string }) {
      if (input.scope === "warehouse") await warehouseOf(ctx, input.id); else await assertZone(ctx, input.id);
      const current = await store.getPause(input.scope, input.id);
      if (current) await store.savePause({ ...current, active: false, by: ctx.actor.userId, at: now() }, audit(ctx, "hours.resume", input.scope, input.id));
      return { ok: true };
    },

    /** The next-morning slots a customer can book, with places left. */
    async slots(zoneId: string) {
      const at = now();
      if (!(await geography.zone(zoneId))) throw notFound("Zone");
      const reason = await closedReason(zoneId, at);
      if (!reason || reason.code === "ZONE_PAUSED") return { available: false, slots: [] as unknown[] };
      const { rows } = await zoneState(zoneId, at);
      const byStart = new Map<string, { start: Date; end: Date; label: string; remaining: number; cutoffAt: Date }>();
      for (const r of rows) {
        if (r.pause || !r.config || r.config.afterHoursMode !== "pre_order" || !r.config.preOrder.enabled) continue;
        const booked = new Map<string, Map<string, number>>();
        for (const s of upcomingSlots(r.config.preOrder, at)) {
          if (!booked.has(s.date)) booked.set(s.date, await store.booked(r.warehouse.id, s.date));
          const remaining = Math.max(0, s.slot.capacity - (booked.get(s.date)!.get(s.slot.start) ?? 0));
          const key = s.start.toISOString();
          const known = byStart.get(key);
          byStart.set(key, { start: s.start, end: s.end, label: s.label, remaining: Math.max(known?.remaining ?? 0, remaining), cutoffAt: s.cutoffAt });
        }
      }
      const slots = [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime())
        .map(s => ({ start: istIso(s.start), end: istIso(s.end), label: s.label, remaining: s.remaining, cutoffAt: istIso(s.cutoffAt) }));
      return { available: slots.length > 0, slots };
    },

    /** Takes a place in the slot for an order. Throws CONFLICT slot_full / cutoff_passed. */
    async hold(orderId: string, warehouseId: string, window: { start: Date; end: Date }): Promise<void> {
      const cfg = await store.getHours(warehouseId);
      const match = cfg && onOfferedDay(window, now()) ? matchSlot(cfg.preOrder, window) : null;
      if (!cfg || !match) throw validation("That time slot is not available", { field: "scheduledWindow" });
      if (match.cutoffAt.getTime() <= now().getTime()) throw conflict("The booking time for that slot has passed", { reason: "cutoff_passed" });
      try { await store.holdSlot({ warehouseId, date: match.date, slotStart: match.slot.start, capacity: match.slot.capacity, orderId, at: now() }); }
      catch (error) { if (error instanceof SlotFullError) throw conflict("That slot is full", { reason: "slot_full" }); throw error; }
    },
    release: (orderId: string) => store.releaseSlot(orderId),

    /** Pre-orders waiting for their slot, with when packing should start and how full each slot is. */
    async listPreorders(ctx: Ctx, query: { date?: string | undefined; warehouseId?: string | undefined; slotStart?: string | undefined }) {
      const at = now();
      const date = query.date ?? istDate(new Date(at.getTime() + 86_400_000));
      const dayStart = istInstant(new Date(`${date}T12:00:00+05:30`), "00:00");
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      let warehouseIds: readonly string[] | undefined = ctx.actor.scope.all ? undefined : ctx.actor.scope.warehouseIds;
      if (query.warehouseId) { await warehouseOf(ctx, query.warehouseId); warehouseIds = [query.warehouseId]; }
      const slotStart = query.slotStart ? istInstant(dayStart, query.slotStart) : undefined;
      const rows = await preorders.list({ from: dayStart, to: dayEnd, ...(warehouseIds && { warehouseIds }), ...(slotStart && { slotStart }) });
      const configs = new Map((await store.getManyHours([...new Set(rows.map(r => r.warehouseId))])).map(c => [c.warehouseId, c]));
      const data = rows.map(r => ({
        orderId: r.orderId, orderNo: r.orderNo, scheduledWindow: { start: istIso(r.scheduledWindow.start), end: istIso(r.scheduledWindow.end) }, status: r.status, itemCount: r.itemCount,
        packingStartsAt: istIso(new Date(r.scheduledWindow.start.getTime() - (configs.get(r.warehouseId)?.preOrder.packLeadMinutes ?? 45) * 60_000)),
      }));
      const whs = warehouseIds ?? [...new Set(rows.map(r => r.warehouseId))];
      const bySlot = new Map<string, { start: string; booked: number; capacity: number }>();
      for (const id of whs) {
        const cfg = (await store.getHours(id)) ?? null;
        if (!cfg) continue;
        const booked = await store.booked(id, date);
        for (const s of cfg.preOrder.slots) {
          const row = bySlot.get(s.start) ?? { start: s.start, booked: 0, capacity: 0 };
          row.booked += booked.get(s.start) ?? 0; row.capacity += s.capacity;
          bySlot.set(s.start, row);
        }
      }
      return { data, count: data.length, bySlot: [...bySlot.values()].sort((a, b) => (a.start < b.start ? -1 : 1)) };
    },
  };
}

export type HoursService = ReturnType<typeof createHoursService>;
