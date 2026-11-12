"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getOrderGroup } from "../../lib/api";
import type { OrderGroup } from "../../lib/types";
import { Icon } from "../../components/ui/Icon";

export const dynamic = "force-dynamic";

function OrderPlacedContent() {
  const searchParams = useSearchParams();
  const groupId = searchParams.get("id") ?? "";

  const [order, setOrder] = useState<OrderGroup | null>(null);

  useEffect(() => {
    if (groupId) {
      getOrderGroup(groupId)
        .then((res) => setOrder(res))
        .catch(() => undefined);
    }
  }, [groupId]);

  const pin = order?.deliveryOtp ?? "";
  const child = order?.children?.[0];

  return (
    <main className="page-container" style={{ textAlign: "center", padding: "60px 16px", maxWidth: 540, margin: "0 auto" }}>
      {/* Green Success Icon */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "var(--green)",
          color: "#ffffff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 10px 24px rgba(31, 157, 98, 0.28)",
          marginBottom: 20,
        }}
      >
        <Icon name="check" size={44} color="#ffffff" />
      </div>

      <h1 className="title" style={{ fontSize: 26, color: "var(--maroon)", marginBottom: 6 }}>
        Order Placed Successfully!
      </h1>
      <p style={{ fontSize: 15, color: "var(--muted)", marginBottom: 24 }}>
        Your items are being handpicked and packed freshly at the store.
      </p>

      {/* Order No & ETA Card */}
      <div
        className="card"
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          background: "var(--card)",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>ORDER NUMBER</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: "var(--ink)" }}>
            #{order?.groupNo || groupId.slice(-6)}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>ESTIMATED TIME</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--green)" }}>
            ⚡ 10–15 Minutes
          </span>
        </div>

        {/* 4-digit Delivery PIN Card */}
        {pin && (
          <div
            style={{
              marginTop: 10,
              padding: "16px",
              background: "var(--yellow-soft)",
              borderRadius: 14,
              border: "1px dashed var(--amber)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--maroon)", textTransform: "uppercase", letterSpacing: 0.8 }}>
              DELIVERY CONFIRMATION CODE
            </span>
            <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: 6, color: "var(--maroon)" }}>
              {pin}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Read this 4-digit code to your delivery partner at the door
            </span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Link
          href={child ? `/tracking/${child.id}?group=${groupId}` : `/orders/${groupId}`}
          className="btn btn-primary"
          style={{ width: "100%", padding: "16px" }}
        >
          Track Delivery Live →
        </Link>
        <Link href="/" className="btn btn-outline" style={{ width: "100%", padding: "14px" }}>
          Back to Home
        </Link>
      </div>
    </main>
  );
}

export default function OrderPlacedPage() {
  return (
    <Suspense fallback={<div className="page-container"><p>Loading...</p></div>}>
      <OrderPlacedContent />
    </Suspense>
  );
}
