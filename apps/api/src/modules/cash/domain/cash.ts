export type LedgerType = "collected" | "deposit" | "adjustment";
export type LedgerFlag = "overpaid" | "unmatched" | "discrepancy";

/** One line of the append-only cash ledger. Money in paise; collected is positive, deposits negative. */
export interface LedgerEntry {
  id: string; riderId: string; warehouseId: string; type: LedgerType; amount: number;
  orderId: string | null; orderNo: string | null;
  /** The rider's total cash in hand, across warehouses, right after this entry. */
  balanceAfter: number; note: string | null; by: string | null; flags: LedgerFlag[]; at: Date;
}

export type ReconciliationType = "upi_unverified" | "overpaid" | "unmatched";
export type ReconciliationOutcome = "verified" | "not_received" | "refund" | "keep" | "adjust";

export interface Reconciliation {
  id: string; type: ReconciliationType; status: "open" | "resolved";
  orderId: string; orderNo: string; riderId: string; riderName: string; warehouseId: string; amount: number; at: Date;
  outcome: ReconciliationOutcome | null; note: string | null; bankReference: string | null; resolvedBy: string | null; resolvedAt: Date | null;
}

/** Which outcomes close which kind of item. */
export const OUTCOMES: Record<ReconciliationType, readonly ReconciliationOutcome[]> = {
  upi_unverified: ["verified", "not_received"], overpaid: ["refund", "keep"], unmatched: ["adjust"],
};

export const ledgerView = (e: LedgerEntry) => ({
  id: e.id, riderId: e.riderId, warehouseId: e.warehouseId, type: e.type, amount: e.amount, orderId: e.orderId, balanceAfter: e.balanceAfter,
  note: e.note, by: e.by, flags: e.flags, at: e.at.toISOString(),
});

export const reconciliationView = (r: Reconciliation) => ({
  id: r.id, type: r.type, orderId: r.orderId, orderNo: r.orderNo, riderId: r.riderId, riderName: r.riderName, warehouseId: r.warehouseId, amount: r.amount,
  at: r.at.toISOString(), status: r.status,
  ...(r.status === "resolved" && { outcome: r.outcome, note: r.note, bankReference: r.bankReference, resolvedBy: r.resolvedBy, resolvedAt: r.resolvedAt?.toISOString() ?? null }),
});
