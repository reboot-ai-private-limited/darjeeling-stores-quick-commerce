"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { listOrders } from "../../lib/api";
import type { OrderSummary } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";

const STEPS = [
  { key: "PLACED", match: ["PLACED", "CONFIRMED"] },
  { key: "PACKING", match: ["PACKING", "PACKED"] },
  { key: "OUT", match: ["OUT_FOR_DELIVERY", "RIDER_ASSIGNED"] },
  { key: "DELIVERED", match: ["DELIVERED"] },
];

export const LiveOrderCard: React.FC = () => {
  const { signedIn } = useStore();
  const [order, setOrder] = useState<OrderSummary | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setOrder(null);
      return;
    }

    let active = true;
    const fetchActive = () => {
      listOrders("active")
        .then((res) => {
          if (active && res.items?.[0]) {
            setOrder(res.items[0]);
          } else if (active) {
            setOrder(null);
          }
        })
        .catch(() => undefined);
    };

    fetchActive();
    const interval = setInterval(fetchActive, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [signedIn]);

  if (!order) return null;

  const child = order.children?.[0];
  const status = child?.status ?? order.status;
  const currentStep = Math.max(0, STEPS.findIndex((s) => s.match.includes(status)));

  return (
    <Link
      href={child ? `/tracking/${child.id}?group=${order.groupId}` : `/orders/${order.groupId}`}
      style={{ textDecoration: "none" }}
    >
      <div className="live-order-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="live-dot" />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--yellow)" }}>
            {status.replace(/_/g, " ")}
          </span>
          <div style={{ flex: 1 }} />
          {child?.promisedAt && (
            <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.8)" }}>
              by {new Date(child.promisedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--white)" }}>
          {status === "OUT_FOR_DELIVERY"
            ? "Your delivery partner is on the way!"
            : status === "PACKING"
            ? "Your items are being packed freshly"
            : "Order confirmed · Tracking live"}
        </h3>

        <div className="progress-track">
          {STEPS.map((st, idx) => (
            <div
              key={st.key}
              className={`progress-step ${idx <= currentStep ? "done" : ""}`}
            />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--yellow)", fontWeight: 700, marginTop: 4 }}>
          <span>Order #{order.groupNo || order.groupId.slice(-6)} · Track Live</span>
          <Icon name="arrow-right" size={14} />
        </div>
      </div>
    </Link>
  );
};
