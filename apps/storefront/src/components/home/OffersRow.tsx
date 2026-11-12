"use client";

import React, { useEffect, useState } from "react";
import { listCoupons } from "../../lib/api";
import { OFFER_TINTS, rupees } from "../../lib/theme";
import type { CouponRow } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";
import { HScroll } from "../ui/HScroll";

export const OffersRow: React.FC = () => {
  const { zone, subtotal, signedIn, setCouponCode, setIsCartDrawerOpen } = useStore();
  const [coupons, setCoupons] = useState<CouponRow[]>([]);

  useEffect(() => {
    if (!signedIn || !zone) {
      setCoupons([]);
      return;
    }
    listCoupons(zone.id, subtotal)
      .then((rows) => setCoupons(rows.filter((c) => c.applicable).slice(0, 6)))
      .catch(() => setCoupons([]));
  }, [zone, subtotal, signedIn]);

  if (coupons.length === 0) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 className="title" style={{ fontSize: 19 }}>Offers for you</h2>
      </div>

      <HScroll
        className="rail"
        style={{ gap: 14, paddingBottom: 8 }}
      >
        {coupons.map((c, idx) => {
          const [bg, fg] = OFFER_TINTS[idx % OFFER_TINTS.length]!;
          return (
            <div
              key={c.code}
              className="coupon-ticket"
              style={{ backgroundColor: bg, borderColor: fg, cursor: "pointer" }}
              onClick={() => {
                setCouponCode(c.code);
                setIsCartDrawerOpen(true);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    background: fg,
                    color: "#ffffff",
                    borderRadius: "50%",
                    width: 26,
                    height: 26,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="percent" size={14} />
                </span>
                <span className="coupon-ticket-code" style={{ borderColor: fg, color: fg }}>
                  {c.code}
                </span>
              </div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginTop: 4 }}>
                {c.description}
              </p>
              {c.minOrder > 0 && (
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  Above {rupees(c.minOrder)}
                </span>
              )}
            </div>
          );
        })}
      </HScroll>
    </div>
  );
};
