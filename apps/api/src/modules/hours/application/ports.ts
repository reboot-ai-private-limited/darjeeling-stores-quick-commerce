import type { AuditEvent } from "../../audit/audit.public.js";
import type { Pause, WarehouseHours } from "../domain/hours.js";

export class SlotFullError extends Error {}

export interface HoursStore {
  ensureIndexes(): Promise<void>;
  getHours(warehouseId: string): Promise<WarehouseHours | null>;
  getManyHours(warehouseIds: readonly string[]): Promise<WarehouseHours[]>;
  saveHours(hours: WarehouseHours, audit?: AuditEvent): Promise<void>;
  getPause(scope: "warehouse" | "zone", id: string): Promise<Pause | null>;
  getPauses(scope: "warehouse" | "zone", ids: readonly string[]): Promise<Pause[]>;
  savePause(pause: Pause, audit?: AuditEvent): Promise<void>;
  /** Takes one place in a slot for an order, once. Throws SlotFullError at capacity. Returns false if the order already holds a place. */
  holdSlot(input: { warehouseId: string; date: string; slotStart: string; capacity: number; orderId: string; at: Date }): Promise<boolean>;
  /** Gives the place back; safe to repeat. */
  releaseSlot(orderId: string): Promise<boolean>;
  booked(warehouseId: string, date: string): Promise<Map<string, number>>;
}

export interface PreorderSource {
  list(query: { from: Date; to: Date; warehouseIds?: readonly string[]; slotStart?: Date }): Promise<{
    orderId: string; orderNo: string; warehouseId: string; status: string; itemCount: number; scheduledWindow: { start: Date; end: Date };
  }[]>;
}

export interface HoursSettings { slotLookaheadDays: number }
export const DEFAULT_HOURS_SETTINGS: HoursSettings = { slotLookaheadDays: 1 };
