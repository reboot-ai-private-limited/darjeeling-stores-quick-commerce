import React from "react";
import Link from "next/link";
import { Icon } from "./Icon";

/** Back arrow + title row used by the account sub-pages. */
export const PageHeader: React.FC<{ title: string; back?: string; sub?: string }> = ({ title, back = "/account", sub }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
    <Link href={back} style={{ color: "var(--maroon)", display: "flex" }} aria-label="Back">
      <Icon name="arrow-left" size={20} />
    </Link>
    <div>
      <h1 className="title" style={{ fontSize: 22 }}>
        {title}
      </h1>
      {sub && <span style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</span>}
    </div>
  </div>
);

export const EmptyState: React.FC<{ icon: string; title: string; text: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div style={{ textAlign: "center", padding: "60px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
    <Icon name={icon} size={40} color="var(--faint)" />
    <h2 className="title" style={{ fontSize: 19 }}>
      {title}
    </h2>
    <p style={{ color: "var(--muted)", fontSize: 14 }}>{text}</p>
    {action && <div style={{ marginTop: 10 }}>{action}</div>}
  </div>
);
