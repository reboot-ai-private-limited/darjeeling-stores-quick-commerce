"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../../components/ui/Icon";

export default function StoreClosedPage() {
  const { storeStatus } = useStore();
  const [notified, setNotified] = useState(false);

  return (
    <main className="page-container" style={{ textAlign: "center", padding: "80px 16px", maxWidth: 520, margin: "0 auto" }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "var(--amber-soft)",
          color: "var(--amber)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon name="clock" size={36} color="var(--amber)" />
      </div>

      <h1 className="title" style={{ fontSize: 24, marginBottom: 8, color: "var(--maroon)" }}>
        We are currently closed
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 24, lineHeight: 1.5 }}>
        Our delivery riders and local store teams are resting for the night. You can still browse our complete catalogue and pre-order for first-slot morning delivery!
      </p>

      {storeStatus?.nextOpenAt && (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: "14px 20px",
            marginBottom: 24,
            display: "inline-block",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
            Reopening At
          </span>
          <p style={{ fontSize: 18, fontWeight: 900, color: "var(--ink)", marginTop: 2 }}>
            {new Date(storeStatus.nextOpenAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 320, margin: "0 auto" }}>
        <Link href="/" className="btn btn-primary" style={{ padding: "14px" }}>
          Browse & Pre-order
        </Link>
        <button
          onClick={() => setNotified(true)}
          className="btn btn-outline"
          disabled={notified}
          style={{ padding: "14px" }}
        >
          {notified ? "✓ We will alert you!" : "Notify me when open"}
        </button>
      </div>
    </main>
  );
}
