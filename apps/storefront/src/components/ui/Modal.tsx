"use client";

import React, { useEffect } from "react";
import { usePresence } from "../../lib/usePresence";
import { Icon } from "./Icon";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
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
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
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
        <div style={{ padding: "20px", overflowY: "auto", maxHeight: "calc(85vh - 70px)" }}>
          {children}
        </div>
      </div>
    </div>
  );
};
