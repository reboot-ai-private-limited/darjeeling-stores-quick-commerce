"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { listOrders } from "../../lib/api";
import { rupees } from "../../lib/theme";
import type { OrderSummary } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { EmptyState, PageHeader } from "../../components/ui/PageHeader";

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Order updates, built from the customer's recent orders (the server has no inbox yet), same as the app. */
export default function NotificationsPage() {
  const { signedIn, booting, setIsLoginModalOpen } = useStore();
  const [rows, setRows] = useState<OrderSummary[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    Promise.all([listOrders("active"), listOrders("past")])
      .then(([a, p]) => setRows([...a.items, ...p.items].sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt)).slice(0, 20)))
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load updates."));
  }, [signedIn]);

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 720 }}>
      <PageHeader title="Updates" back="/" />
      {!booting && !signedIn && (
        <EmptyState
          icon="bell"
          title="Sign in to see updates"
          text="Your order updates will show up here."
          action={<button className="btn btn-primary" onClick={() => setIsLoginModalOpen(true)}>Sign in</button>}
        />
      )}
      {signedIn && !rows && !err && <div className="skeleton" style={{ height: 80 }} />}
      {err && <EmptyState icon="wifi-off" title="Couldn't load" text={err} />}
      {rows?.length === 0 && <EmptyState icon="bell" title="No updates yet" text="Order updates will show up here." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows?.map((o) => (
          <Link key={o.groupId} href={`/orders/${o.groupId}`} className="card" style={{ padding: 16, display: "block" }}>
            <div style={{ fontWeight: 800 }}>{label(o.children[0]?.status ?? o.status)}</div>
            <div className="small" style={{ marginTop: 4 }}>
              {o.groupNo} · {rupees(o.total)} · {ago(o.createdAt)}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
