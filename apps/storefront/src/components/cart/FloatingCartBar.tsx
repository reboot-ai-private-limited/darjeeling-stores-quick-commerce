"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { rupees } from "../../lib/theme";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";

export const FloatingCartBar: React.FC = () => {
  const { count, subtotal, storeStatus, setIsCartDrawerOpen } = useStore();
  const pathname = usePathname();

  // The product page has its own pinned buy bar.
  if (count === 0 || pathname.startsWith("/product/")) return null;

  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} min` : "10-15 min";

  return (
    <div className="floating-cart-bar mobile-only" onClick={() => setIsCartDrawerOpen(true)}>
      <div className="floating-cart-info">
        <span className="floating-cart-title">
          {count} {count === 1 ? "item" : "items"} · {rupees(subtotal)}
        </span>
        <span className="floating-cart-sub">Arriving in {eta}</span>
      </div>
      <div className="floating-cart-cta">
        <span>View cart</span>
        <Icon name="arrow-right" size={14} color="var(--maroon)" />
      </div>
    </div>
  );
};
