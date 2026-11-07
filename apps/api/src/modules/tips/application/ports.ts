import type { AuditEvent } from "../../audit/audit.public.js";

export interface TipRow {
  orderId: string; orderNo: string; riderId: string; warehouseId: string; amount: number; deliveredAt: Date;
  status: "owed" | "paid"; paidAt: Date | null;
}
export interface TipTotals { count: number; total: number; owed: number; paid: number }
export interface TipFilter {
  start: Date; end: Date; riderId?: string | undefined;
  /** `null` means every warehouse. */
  warehouseIds: readonly string[] | null;
}

export interface TipStore {
  /** Newest first. */
  list(filter: TipFilter & { status?: "owed" | "paid" | undefined; limit: number }): Promise<TipRow[]>;
  totals(filter: TipFilter): Promise<TipTotals>;
  /** The same figures for each rider who earned a tip in the range. */
  byRider(filter: TipFilter): Promise<(TipTotals & { riderId: string; riderName: string })[]>;
  /**
   * Marks owed tips as paid, once each, together with the audit record. Either the listed orders or every owed tip delivered before `before`.
   * Orders that are already paid, belong to another rider or are outside the warehouses are left alone.
   */
  pay(input: {
    riderId: string; orderIds?: readonly string[] | undefined; before?: Date | undefined; warehouseIds: readonly string[] | null; by: string; note: string | null; at: Date;
    audit: (summary: { count: number; amount: number }) => AuditEvent;
  }): Promise<{ count: number; amount: number }>;
}
