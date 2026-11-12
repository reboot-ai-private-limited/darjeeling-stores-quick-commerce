"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, syncCartRemote } from "../../lib/api";
import { applyCouponRemote, COUPON_WHY, listCouponOffers, removeCouponRemote, type CouponOffer } from "../../lib/account-api";
import { rupees } from "../../lib/theme";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";

const stub = (c: CouponOffer): { top: string; bottom: string } =>
  c.type === "percent" ? { top: `${c.value}%`, bottom: "OFF" } : c.type === "flat" ? { top: rupees(c.value), bottom: "OFF" } : { top: "FREE", bottom: "DELIVERY" };

/**
 * The "Apply coupon" row of the cart. Shows the applied coupon, or a button that opens a sheet with a code box
 * and every offer (greyed, with the reason, when it cannot be used yet) just like the app's coupon screen.
 */
export const CouponPicker: React.FC = () => {
  const { zone, lines, subtotal, couponCode, setCouponCode, signedIn, setIsLoginModalOpen } = useStore();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CouponOffer[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!zone || !signedIn) {
      setRows([]);
      return;
    }
    listCouponOffers(zone.id, subtotal)
      .then(setRows)
      .catch(() => setRows([]));
  }, [zone, signedIn, subtotal]);

  useEffect(() => {
    if (open) {
      setErr("");
      setDone(null);
      load();
    }
  }, [open, load]);

  const apply = async (c: string) => {
    const wanted = c.trim().toUpperCase();
    if (!wanted) return;
    if (!signedIn) {
      setOpen(false);
      setIsLoginModalOpen(true);
      return;
    }
    setBusy(wanted);
    setErr("");
    try {
      // The server checks the coupon against its copy of the cart, so send the cart first.
      if (zone && lines.length > 0) {
        await syncCartRemote(lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })));
      }
      const applied = await applyCouponRemote(wanted);
      setCouponCode(applied.code);
      setDone(applied.code);
      setCode("");
      setTimeout(() => {
        setOpen(false);
        setDone(null);
      }, 1100);
    } catch (e) {
      const why = e instanceof ApiError ? COUPON_WHY[String(e.details?.reason)] : undefined;
      setErr(why ?? (e instanceof Error ? e.message : "That coupon can't be used."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setCouponCode(null);
    try {
      await removeCouponRemote();
    } catch {
      /* the cart may not exist on the server yet; the local code is already cleared */
    }
  };

  const sorted = rows ? [...rows].sort((a, b) => Number(b.applicable) - Number(a.applicable)) : null;
  const why = (c: CouponOffer) => {
    if (c.applicable) return null;
    if (c.reason === "min_order" && c.minOrder > subtotal) return `Add ${rupees(c.minOrder - subtotal)} more to use this`;
    return COUPON_WHY[c.reason ?? ""] ?? "Not available right now";
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--cream)", borderRadius: 12, border: "1px dashed var(--line)" }}>
        <Icon name="percent" size={16} color="var(--maroon)" />
        {couponCode ? (
          <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--green)" }}>Coupon &apos;{couponCode}&apos; applied</span>
            <button onClick={() => void remove()} style={{ fontSize: 12, color: "var(--red)", fontWeight: 700 }}>
              Remove
            </button>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Apply coupon</span>
            <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 800, color: "var(--maroon)" }}>
              View offers <Icon name="chevron-right" size={14} />
            </span>
          </button>
        )}
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Apply coupon">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {done && (
                <div style={{ background: "var(--green-soft)", borderRadius: 16, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="check" size={16} color="#fff" />
                  </span>
                  <strong style={{ color: "var(--green)" }}>{done} applied</strong>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--white)", border: "1.5px solid var(--line)", borderRadius: 8, padding: "0 6px 0 16px", height: 52 }}>
                <Icon name="tag" size={18} color="var(--muted)" />
                <input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase().replace(/\s/g, ""));
                    setErr("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void apply(code);
                  }}
                  placeholder="Have a code? Enter it here"
                  maxLength={20}
                  aria-label="Coupon code"
                  style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 800, letterSpacing: 1 }}
                />
                <button
                  onClick={() => void apply(code)}
                  disabled={!code.trim() || !!busy}
                  style={{ height: 40, padding: "0 18px", borderRadius: 8, background: "var(--maroon)", color: "var(--yellow)", fontWeight: 900, fontSize: 13, letterSpacing: 0.8, opacity: !code.trim() || busy ? 0.4 : 1 }}
                >
                  {busy === code.trim() ? "…" : "APPLY"}
                </button>
              </div>

              {err && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--red-soft)", color: "var(--red)", borderRadius: 12, padding: "10px 12px", fontSize: 13, fontWeight: 600 }}>
                  <Icon name="alert-triangle" size={15} />
                  {err}
                </div>
              )}

              <span className="label" style={{ marginTop: 4 }}>
                Available offers
              </span>

              {!signedIn && (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <p className="small" style={{ marginBottom: 10 }}>
                    Sign in to see offers made for you.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setOpen(false);
                      setIsLoginModalOpen(true);
                    }}
                  >
                    Sign in
                  </button>
                </div>
              )}

              {signedIn && !sorted && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 104, borderRadius: 8 }} />)}

              {signedIn && sorted?.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <Icon name="tag" size={38} color="var(--faint)" />
                  <h3 style={{ marginTop: 8 }}>No offers right now</h3>
                  <p className="small">New offers show up here. You can still enter a code above.</p>
                </div>
              )}

              {sorted?.map((c) => {
                const st = stub(c);
                const on = c.applicable;
                const isApplied = couponCode === c.code;
                const reason = why(c);
                return (
                  <div key={c.code} style={{ display: "flex", background: "var(--white)", borderRadius: 8, overflow: "hidden", boxShadow: "var(--shadow-card)", opacity: on ? 1 : 0.6 }}>
                    <div style={{ width: 92, background: on ? "var(--maroon)" : "var(--faint)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 6px", textAlign: "center" }}>
                      <span style={{ color: "var(--yellow)", fontSize: st.top.length > 4 ? 18 : 24, fontWeight: 900, letterSpacing: -0.5 }}>{st.top}</span>
                      <span style={{ color: "#fff", fontSize: 11, fontWeight: 900, letterSpacing: 1.5, marginTop: 2 }}>{st.bottom}</span>
                    </div>
                    <div style={{ borderLeft: "1.5px dashed var(--line)" }} />
                    <div style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      <span style={{ border: "1.5px dashed var(--maroon)", borderRadius: 8, padding: "2px 8px", background: "var(--yellow-soft)", color: "var(--maroon)", fontWeight: 900, letterSpacing: 1.2, fontSize: 13 }}>{c.code}</span>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{c.description}</span>
                      {c.minOrder > 0 && <span className="small">Min. order {rupees(c.minOrder)}</span>}
                      {reason && (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--amber-soft)", color: "var(--amber)", borderRadius: 8, padding: "4px 8px", fontWeight: 800, fontSize: 12 }}>
                          <Icon name="info" size={13} />
                          {reason}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          if (!isApplied) void apply(c.code);
                        }}
                        disabled={!on || isApplied || !!busy}
                        style={{
                          marginTop: 6,
                          height: 34,
                          padding: "0 14px",
                          borderRadius: 8,
                          background: isApplied ? "var(--green-soft)" : on ? "var(--yellow)" : "var(--cream-deep)",
                          color: isApplied ? "var(--green)" : on ? "var(--maroon)" : "var(--muted)",
                          fontWeight: 900,
                          fontSize: 12,
                          letterSpacing: 0.6,
                          cursor: on && !isApplied ? "pointer" : "default",
                        }}
                      >
                        {isApplied ? "APPLIED" : busy === c.code ? "…" : "TAP TO APPLY"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Modal>,
          document.body
        )}
    </>
  );
};
