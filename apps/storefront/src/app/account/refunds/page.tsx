"use client";

import React, { useCallback, useEffect, useState } from "react";
import { listRefunds, REFUND_REASON, type Refund } from "../../../lib/account-api";
import { rupees } from "../../../lib/theme";
import { useStore } from "../../../state/StoreContext";
import { EmptyState, PageHeader } from "../../../components/ui/PageHeader";

const TONE: Record<Refund["status"], [string, string, string]> = {
  requested: ["Requested", "var(--amber-soft)", "var(--amber)"],
  approved: ["Approved", "var(--blue-soft)", "var(--blue)"],
  done: ["Refunded", "var(--green-soft)", "var(--green)"],
  rejected: ["Rejected", "var(--red-soft)", "var(--red)"],
};
const METHOD: Record<string, string> = { razorpay_dashboard: "to your original payment method", upi: "by UPI", cash: "in cash" };

export default function RefundsPage() {
  const { signedIn, booting, setIsLoginModalOpen } = useStore();
  const [rows, setRows] = useState<Refund[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setErr("");
    listRefunds()
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load refunds."));
  }, []);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 720 }}>
      <PageHeader title="My refunds" />
      {!booting && !signedIn && (
        <EmptyState
          icon="user"
          title="Sign in to see refunds"
          text="Refunds for cancelled or problem orders show up here."
          action={<button className="btn btn-primary" onClick={() => setIsLoginModalOpen(true)}>Sign in</button>}
        />
      )}
      {signedIn && !rows && !err && <div className="skeleton" style={{ height: 96 }} />}
      {err && <EmptyState icon="wifi-off" title="Couldn't load" text={err} action={<button className="btn btn-soft" onClick={load}>Try again</button>} />}
      {rows?.length === 0 && <EmptyState icon="check-circle" title="No refunds" text="Refunds for cancelled or problem orders show up here." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows?.map((r) => {
          const [label, bg, fg] = TONE[r.status];
          return (
            <div key={r.id} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ flex: 1, fontSize: 19, fontWeight: 800 }}>{rupees(r.amount)}</span>
                <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 8, letterSpacing: 0.5 }}>{label.toUpperCase()}</span>
              </div>
              <span style={{ fontSize: 15, fontWeight: 500 }}>
                {r.orderNo} · {REFUND_REASON[r.reason] ?? r.reason}
              </span>
              <span className="small">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
              {r.status === "done" && r.method && (
                <span className="small" style={{ color: "var(--green)" }}>
                  Paid {METHOD[r.method] ?? ""}
                </span>
              )}
              {r.status === "rejected" && r.rejectReason && (
                <span className="small" style={{ color: "var(--red)" }}>
                  {r.rejectReason}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
