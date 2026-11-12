"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ensureCartSynced } from "../../lib/api";
import { rupees } from "../../lib/theme";
import { useStore } from "../../state/StoreContext";
import { Drawer } from "../ui/Drawer";
import { Icon } from "../ui/Icon";
import { CouponPicker } from "./CouponPicker";

export const CartDrawer: React.FC = () => {
  const router = useRouter();
  const {
    isCartDrawerOpen,
    setIsCartDrawerOpen,
    lines,
    count,
    subtotal,
    savings,
    inc,
    remove,
    removeLine,
    storeStatus,
    signedIn,
    setIsLoginModalOpen,
    couponCode,
    setCouponCode,
    applyServerCart,
  } = useStore();

  // Signed-in customers: send the cart to the server so the prices and stock we show are the ones it will charge.
  const signature = lines.map((l) => l.variantId + ":" + l.qty).join("|");
  useEffect(() => {
    if (!isCartDrawerOpen || !signedIn || lines.length === 0) return;
    let live = true;
    const t = setTimeout(() => {
      ensureCartSynced(lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })))
        .then((res) => {
          if (live && res) applyServerCart(res.cart.items, res.corrections);
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [isCartDrawerOpen, signedIn, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} mins` : "10-15 mins";
  // The delivery fee depends on the address and the zone's rules, so the server works it out at checkout. // Free delivery above ₹199
  const freeDeliveryThreshold = storeStatus?.freeDeliveryAbove ?? null;
  const remainingForFreeDelivery = freeDeliveryThreshold === null ? 0 : Math.max(0, freeDeliveryThreshold - subtotal);
  const totalPaise = subtotal;
  const minOrder = storeStatus?.minOrder ?? 0;
  const belowMin = minOrder > 0 && subtotal < minOrder;

  const handleCheckout = () => {
    setIsCartDrawerOpen(false);
    if (!signedIn) {
      setIsLoginModalOpen(true);
    } else {
      router.push("/checkout");
    }
  };

  return (
    <Drawer
      isOpen={isCartDrawerOpen}
      onClose={() => setIsCartDrawerOpen(false)}
      title={`My Cart (${count} ${count === 1 ? "item" : "items"})`}
    >
      {lines.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            textAlign: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "var(--yellow-soft)",
              color: "var(--maroon)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="shopping-bag" size={36} color="var(--maroon)" />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--maroon)" }}>Your cart is empty</h3>
          <p style={{ fontSize: 14, color: "var(--muted)", maxWidth: 240 }}>
            Fill it with fresh Darjeeling tea, snacks and daily kitchen groceries!
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setIsCartDrawerOpen(false)}
            style={{ marginTop: 8 }}
          >
            Start shopping
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "16px 20px" }}>
          {/* Delivery ETA banner */}
          <div
            style={{
              background: "var(--yellow-soft)",
              padding: "10px 14px",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--maroon)",
            }}
          >
            <Icon name="clock" size={16} color="var(--maroon)" />
            <span>Delivery in {eta}</span>
          </div>

          {/* Free delivery progress */}
          {freeDeliveryThreshold === null ? null : remainingForFreeDelivery > 0 ? (
            <div
              style={{
                background: "var(--cream)",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid var(--line)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
                <span>Add {rupees(remainingForFreeDelivery)} more for FREE delivery</span>
                <span style={{ color: "var(--maroon)" }}>
                  {Math.round((subtotal / freeDeliveryThreshold) * 100)}%
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--line)",
                  marginTop: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, (subtotal / freeDeliveryThreshold) * 100)}%`,
                    background: "var(--green)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "var(--green-soft)",
                color: "var(--green)",
                padding: "8px 14px",
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="check-circle" size={14} />
              <span>You have unlocked FREE delivery!</span>
            </div>
          )}

          {/* Cart items list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {lines.map((item) => (
              <div
                key={item.variantId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 10,
                    background: "var(--yellow-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <Icon name="package" size={20} color="var(--faint)" />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.name}
                  </h4>
                  <p style={{ fontSize: 12, color: "var(--muted)" }}>{item.label}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>{rupees(item.price)}</span>
                    {item.mrp > item.price && (
                      <span style={{ fontSize: 11, color: "var(--muted)", textDecoration: "line-through" }}>
                        {rupees(item.mrp)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="stepper" style={{ height: 28 }}>
                  <button
                    className="stepper-btn"
                    style={{ width: 24 }}
                    onClick={() => remove(item.variantId)}
                  >
                    <Icon name="minus" size={12} color="#ffffff" />
                  </button>
                  <span className="stepper-qty" style={{ fontSize: 12 }}>{item.qty}</span>
                  <button
                    className="stepper-btn"
                    style={{ width: 24 }}
                    disabled={item.qty >= item.maxQty}
                    onClick={() => inc(item.variantId)}
                  >
                    <Icon name="plus" size={12} color="#ffffff" />
                  </button>
                </div>

                <button
                  onClick={() => removeLine(item.variantId)}
                  style={{ color: "var(--faint)", padding: 4 }}
                  title="Remove item"
                >
                  <Icon name="trash-2" size={16} />
                </button>
              </div>
            ))}
          </div>

          {/* Coupon apply row */}
          <CouponPicker />

          {/* Bill breakdown */}
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Item total</span>
              <span>{rupees(subtotal)}</span>
            </div>

            {savings > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--green)" }}>
                <span>MRP discount</span>
                <span>-{rupees(savings)}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Delivery partner fee</span>
              <span><span style={{ color: "var(--muted)", fontSize: 13 }}>Calculated at checkout</span></span>
            </div>

            <div
              style={{
                borderTop: "1px dashed var(--line)",
                paddingTop: 8,
                marginTop: 4,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 15,
                fontWeight: 800,
                color: "var(--ink)",
              }}
            >
              <span>Total</span>
              <span>{rupees(totalPaise)}</span>
            </div>
          </div>

          {/* Checkout CTA */}
          {belowMin && (
            <div style={{ background: "var(--amber-soft)", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
              The minimum order is {rupees(minOrder)}. Add {rupees(minOrder - subtotal)} more to check out.
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleCheckout}
            disabled={belowMin}
            style={{
              width: "100%",
              padding: "14px 20px",
              fontSize: 15,
              borderRadius: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              opacity: belowMin ? 0.5 : 1,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <span style={{ fontSize: 14, fontWeight: 800 }}>{rupees(totalPaise)}</span>
              <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.75)" }}>TOTAL</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>Proceed to Checkout</span>
              <Icon name="arrow-right" size={16} />
            </div>
          </button>
        </div>
      )}
    </Drawer>
  );
};
