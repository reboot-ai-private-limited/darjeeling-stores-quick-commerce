"use client";

import React, { useEffect, useState } from "react";
import { listOrders, reorder } from "../../lib/api";
import { rupees } from "../../lib/theme";
import type { OrderSummary } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";

export const OrderAgainCard: React.FC = () => {
  const { signedIn, setIsCartDrawerOpen } = useStore();
  const [lastOrder, setLastOrder] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      setLastOrder(null);
      return;
    }
    listOrders("past")
      .then((res) => {
        const delivered = res.items?.find((o) => o.status === "DELIVERED");
        if (delivered) setLastOrder(delivered);
      })
      .catch(() => setLastOrder(null));
  }, [signedIn]);

  if (!lastOrder || !lastOrder.children?.[0]) return null;

  const child = lastOrder.children[0];

  const handleReorder = async () => {
    setLoading(true);
    try {
      await reorder(child.id);
      setIsCartDrawerOpen(true);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        marginTop: 12,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--yellow-soft)",
        borderColor: "var(--amber)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            background: "var(--maroon)",
            color: "var(--yellow)",
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="repeat" size={20} />
        </div>
        <div>
          <h4 style={{ fontSize: 15, fontWeight: 800, color: "var(--maroon)" }}>
            Order again from your last delivery
          </h4>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {child.itemCount} items · {rupees(lastOrder.total)}
          </p>
        </div>
      </div>
      <button
        className="btn btn-primary"
        onClick={handleReorder}
        disabled={loading}
        style={{ padding: "8px 18px", fontSize: 13 }}
      >
        {loading ? "Adding..." : "Reorder"}
      </button>
    </div>
  );
};
