import React from "react";
import { Icon } from "../ui/Icon";

const TRUST_ITEMS = [
  { icon: "zap", title: "Fast delivery", sub: "At your door in minutes" },
  { icon: "feather", title: "Fresh & local", sub: "Straight from Darjeeling" },
  { icon: "credit-card", title: "Pay your way", sub: "Cash, UPI or cards" },
];

export const TrustStrip: React.FC = () => {
  return (
    <div
      style={{
        marginTop: 40,
        marginBottom: 20,
        padding: "24px 16px",
        background: "var(--card)",
        borderRadius: 22,
        border: "1px solid var(--line)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 20,
        textAlign: "center",
      }}
    >
      {TRUST_ITEMS.map((t) => (
        <div key={t.title} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "var(--yellow-soft)",
              color: "var(--maroon)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={t.icon} size={22} color="var(--maroon)" />
          </div>
          <h4 style={{ fontSize: 15, fontWeight: 800, color: "var(--maroon)" }}>{t.title}</h4>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>{t.sub}</p>
        </div>
      ))}
    </div>
  );
};
