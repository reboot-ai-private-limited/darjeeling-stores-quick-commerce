import type { AuditEvent } from "../../audit/audit.public.js";
import type { LedgerEntry, LedgerType, Reconciliation, ReconciliationOutcome } from "../domain/cash.js";

export type NewEntry = Omit<LedgerEntry, "id" | "balanceAfter">;
export type NewReconciliation = Omit<Reconciliation, "id" | "status" | "outcome" | "note" | "bankReference" | "resolvedBy" | "resolvedAt">;

/** Thrown when cash for the order was already recorded, so a repeat does not add it twice. */
export class DuplicateCollectionError extends Error {}
/** Thrown when a deposit is larger than the cash the rider holds for the warehouse. */
export class InsufficientCashError extends Error { constructor(readonly held: number) { super("Not enough cash held"); } }

export interface RiderBalance { riderId: string; total: number; byWarehouse: { warehouseId: string; amount: number }[]; lastDepositAt: Date | null }

export interface CashStore {
  ensureIndexes(): Promise<void>;
  /**
   * Adds one ledger entry, moves the rider's balances and writes any reconciliation items and audit record, all in one transaction.
   * With `limit` the warehouse balance must cover a negative amount (a deposit).
   */
  post(entry: NewEntry, options?: { limit?: boolean; reconciliations?: NewReconciliation[]; audit?: AuditEvent }): Promise<LedgerEntry>;
  collectedFor(orderId: string): Promise<LedgerEntry | null>;
  /** The net cash recorded for an order: collected plus any adjustment made for it. */
  netForOrder(orderId: string): Promise<number>;
  listLedger(filter: { riderId?: string; warehouseIds?: readonly string[]; type?: LedgerType; from?: Date; to?: Date }, limit: number, beforeId?: string): Promise<LedgerEntry[]>;
  entriesSince(riderId: string, since: Date): Promise<LedgerEntry[]>;
  balanceOf(riderId: string): Promise<RiderBalance>;
  balances(filter: { riderIds?: readonly string[]; warehouseIds?: readonly string[] }): Promise<RiderBalance[]>;

  /** Adds an item unless the order already has an open one of that type. Returns the item that is now there. */
  openReconciliation(item: NewReconciliation): Promise<Reconciliation>;
  getReconciliation(id: string): Promise<Reconciliation | null>;
  findReconciliation(orderId: string, type: string): Promise<Reconciliation | null>;
  listReconciliation(filter: { type?: string; status?: "open" | "resolved"; warehouseIds?: readonly string[]; riderId?: string }, limit: number, beforeId?: string): Promise<Reconciliation[]>;
  openCount(warehouseIds?: readonly string[]): Promise<number>;
  /** Closes an open item once. False when it was already closed. */
  closeReconciliation(id: string, patch: { outcome: ReconciliationOutcome; note: string | null; bankReference: string | null; by: string; at: Date }): Promise<boolean>;
  reopenReconciliation(id: string): Promise<void>;
  recordAudit(entry: AuditEvent): Promise<void>;
}

export interface RiderDirectory {
  get(id: string): Promise<{ id: string; name: string; zoneId: string } | null>;
  getMany(ids: readonly string[]): Promise<{ id: string; name: string; zoneId: string }[]>;
}

/** What cash needs to know about how a rider stands with an order (Dispatch). */
export interface OrderRelations {
  relation(riderId: string, orderId: string): Promise<"live" | "finished" | "ended" | "none">;
  riderOfOrder(orderId: string): Promise<string | null>;
  deliveredToday(riderId: string): Promise<number>;
}
