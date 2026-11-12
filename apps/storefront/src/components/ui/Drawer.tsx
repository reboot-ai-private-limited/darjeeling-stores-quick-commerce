"use client";

import React, { useEffect } from "react";
import { usePresence } from "../../lib/usePresence";
import { Icon } from "./Icon";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, title, children }) => {
  const { mounted, visible } = usePresence(isOpen);
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div className={`modal-backdrop${visible ? " is-open" : ""}`} onClick={onClose}>
      <div className="drawer-right" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
            background: "var(--card)",
          }}
        >
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--maroon)" }}>
            {title ?? ""}
          </h3>
          <button
            onClick={onClose}
            style={{
              padding: 6,
              borderRadius: "50%",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    </div>
  );
};
