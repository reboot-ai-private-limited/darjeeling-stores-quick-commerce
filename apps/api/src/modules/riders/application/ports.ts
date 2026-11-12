import type { Rider, RiderStatus, Shift } from "../domain/rider.js";


export interface RiderFilters {
  zoneId?: string | undefined; warehouseId?: string | undefined; status?: RiderStatus | "deactivated" | undefined; q?: string | undefined;
  /** Only riders serving one of these warehouses (a scoped admin). `null` for no limit. */
  scope: readonly string[] | null;
}
export interface ShiftFilters { riderId?: string | undefined; warehouseId?: string | undefined; from?: Date | undefined; to?: Date | undefined; scope: readonly string[] | null }

export class DuplicateRiderError extends Error { constructor(readonly field: "userId" | "phone") { super(`A rider with this ${field} exists`); this.name = "DuplicateRiderError"; } }

export interface RiderStore {
  ensureIndexes(): Promise<void>;
  insert(rider: Rider): Promise<void>;
  get(id: string): Promise<Rider | null>;
  getByUserId(userId: string): Promise<Rider | null>;
  getMany(ids: readonly string[]): Promise<Rider[]>;
  list(filters: RiderFilters, limit: number): Promise<Rider[]>;
  /** Every active rider, for the dispatch suggestions. */
  listActive(): Promise<Rider[]>;
  /** Saves fields of a rider, optionally only if it still has a given shift and active state. False when the condition no longer holds. */
  update(id: string, patch: Partial<Rider>, when?: { currentShiftId?: string | null; isActive?: boolean }): Promise<boolean>;
  /** Takes a shift for a rider who has none, in one atomic step. Null when they are inactive or already on a shift. */
  claimShift(riderId: string, shiftId: string, patch: Partial<Rider>): Promise<Rider | null>;
  insertShift(shift: Shift): Promise<void>;
  getShift(id: string): Promise<Shift | null>;
  updateShift(id: string, patch: Partial<Shift>): Promise<void>;
  listShifts(filters: ShiftFilters, beforeId: string | undefined, limit: number): Promise<Shift[]>;
  /** Adds one to the rider's open orders if that stays within the limit. False when the rider is full. */
  reserveCapacity(riderId: string, max: number, n?: number): Promise<boolean>;
  releaseCapacity(riderId: string, n?: number): Promise<void>;
  setActiveCount(riderId: string, count: number): Promise<void>;
  /** Marks online riders who have not been heard from since the cutoff as offline; returns who. */
  markStaleOffline(cutoff: Date, at: Date): Promise<Rider[]>;
}

/** Facts about a rider's orders that only dispatch knows. */
export interface RiderLoads { pickedUpCount(riderId: string): Promise<number> }

export interface RiderMedia {
  /** Checks a profile photo is a finished `rider_photo` uploaded by that user, and attaches it to the rider. */
  claim(input: { mediaId: string; userId: string; riderId: string }): Promise<void>;
  release(mediaId: string, reason: string): Promise<void>;
}
