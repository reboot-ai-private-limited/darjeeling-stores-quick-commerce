"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listOrders, reorder } from "../../../lib/api";
import { rupees } from "../../../lib/theme";
import type { OrderSummary } from "../../../lib/types";
import { useStore } from "../../../state/StoreContext";
import { Icon } from "../../../components/ui/Icon";

export default function OrdersHistoryPage() {
  const router = useRouter();
  const { signedIn, setIsLoginModalOpen, setIsCartDrawerOpen } = useStore();

  const [tab, setTab] = useState<"active" | "past">("active");
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      return;
    }

    setLoading(true);
    listOrders(tab)
      .then((res) => setOrders(res.items ?? []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [tab, signedIn]);

  const handleReorder = async (childId: string) => {
    setReorderingId(childId);
    try {
      await reorder(childId);
      setIsCartDrawerOpen(true);
    } catch {
      alert("Could not reorder items. Some may be out of stock.");
    } finally {
      setReorderingId(null);
    }
  };

  if (!signedIn) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "60px 16px" }}>
        <h2 className="title" style={{ marginBottom: 12 }}>Please sign in to view your orders</h2>
        <button className="btn btn-primary" onClick={() => setIsLoginModalOpen(true)}>
          Sign In
        </button>
      </main>
    );
  }

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/account" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1 className="title" style={{ fontSize: 22 }}>My Orders</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 12, marginBottom: 20 }}>
        <button
          onClick={() => setTab("active")}
          style={{
            padding: "8px 20px",
            borderRadius: 9999,
            fontSize: 14,
            fontWeight: 800,
            border: "none",
            background: tab === "active" ? "var(--maroon)" : "var(--card)",
            color: tab === "active" ? "#ffffff" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          Active Orders
        </button>
        <button
          onClick={() => setTab("past")}
          style={{
            padding: "8px 20px",
            borderRadius: 9999,
            fontSize: 14,
            fontWeight: 800,
            border: "none",
            background: tab === "past" ? "var(--maroon)" : "var(--card)",
            color: tab === "past" ? "#ffffff" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          Past Orders
        </button>
      </div>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 16px" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--yellow-soft)",
              color: "var(--maroon)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Icon name="package" size={32} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--maroon)" }}>
            {tab === "active" ? "No active orders right now" : "No past orders yet"}
          </h3>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4, marginBottom: 20 }}>
            {tab === "active"
              ? "All your deliveries have arrived or you haven't placed an order yet."
              : "When you place an order, it will appear here for easy reordering."}
          </p>
          <Link href="/" className="btn btn-primary">Start shopping</Link>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {orders.map((order) => {
            const child = order.children?.[0];
            const isDelivered = order.status === "DELIVERED";

            return (
              <div key={order.groupId} className="card" style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 12 }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                      ORDER #{order.groupNo || order.groupId.slice(-6)}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {new Date(order.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      padding: "4px 10px",
                      borderRadius: 6,
                      background: isDelivered ? "var(--green-soft)" : "var(--yellow-soft)",
                      color: isDelivered ? "var(--green)" : "var(--maroon)",
                    }}
                  >
                    {order.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>
                      {rupees(order.total)}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>
                      ({order.children?.reduce((n, c) => n + c.itemCount, 0) ?? 0} items)
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    {isDelivered && child ? (
                      <button
                        className="btn btn-outline"
                        disabled={reorderingId === child.id}
                        onClick={() => handleReorder(child.id)}
                        style={{ padding: "8px 16px", fontSize: 13 }}
                      >
                        {reorderingId === child.id ? "Adding..." : "Reorder"}
                      </button>
                    ) : (
                      child && (
                        <Link
                          href={`/tracking/${child.id}?group=${order.groupId}`}
                          className="btn btn-primary"
                          style={{ padding: "8px 16px", fontSize: 13 }}
                        >
                          Track Live
                        </Link>
                      )
                    )}

                    <Link
                      href={`/orders/${order.groupId}`}
                      className="btn btn-soft"
                      style={{ padding: "8px 14px", fontSize: 13 }}
                    >
                      Details →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
