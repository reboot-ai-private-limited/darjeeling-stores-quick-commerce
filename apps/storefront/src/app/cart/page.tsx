"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ensureCartSynced } from "../../lib/api";
import { rupees } from "../../lib/theme";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../../components/ui/Icon";
import { CouponPicker } from "../../components/cart/CouponPicker";

export default function CartPage() {
  const router = useRouter();
  const {
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
    if (!true || !signedIn || lines.length === 0) return;
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
  }, [true, signedIn, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} mins` : "10-15 mins";
  // The delivery fee depends on the address and the zone's rules, so the server works it out at checkout.
  const freeDeliveryThreshold = storeStatus?.freeDeliveryAbove ?? null;
  const remainingForFreeDelivery = freeDeliveryThreshold === null ? 0 : Math.max(0, freeDeliveryThreshold - subtotal);
  const totalPaise = subtotal;
  const minOrder = storeStatus?.minOrder ?? 0;
  const belowMin = minOrder > 0 && subtotal < minOrder;

  const handleCheckout = () => {
    if (!signedIn) {
      setIsLoginModalOpen(true);
    } else {
      router.push("/checkout");
    }
  };

  if (lines.length === 0) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "80px 16px" }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "var(--yellow-soft)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Icon name="shopping-bag" size={40} color="var(--maroon)" />
        </div>
        <h1 className="title" style={{ marginBottom: 8 }}>Your cart is empty</h1>
        <p style={{ color: "var(--muted)", maxWidth: 360, margin: "0 auto 24px" }}>
          Add your favourite teas, snacks, spices and essentials to enjoy lightning-fast delivery!
        </p>
        <Link href="/" className="btn btn-primary" style={{ padding: "12px 28px" }}>
          Start Shopping
        </Link>
      </main>
    );
  }

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1 className="title" style={{ fontSize: 22 }}>
          Shopping Cart ({count} {count === 1 ? "item" : "items"})
        </h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
        {/* Left: Items list & Free delivery progress */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              background: "var(--yellow-soft)",
              padding: "12px 16px",
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontWeight: 700,
              color: "var(--maroon)",
              fontSize: 14,
            }}
          >
            <Icon name="clock" size={18} color="var(--maroon)" />
            <span>Delivery in {eta}</span>
          </div>

          {freeDeliveryThreshold === null ? null : remainingForFreeDelivery > 0 ? (
            <div
              style={{
                background: "var(--card)",
                padding: "12px 16px",
                borderRadius: 14,
                border: "1px solid var(--line)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                <span>Add {rupees(remainingForFreeDelivery)} more for FREE delivery</span>
                <span style={{ color: "var(--maroon)" }}>
                  {Math.round((subtotal / freeDeliveryThreshold) * 100)}%
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "var(--line)", marginTop: 8, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, (subtotal / freeDeliveryThreshold) * 100)}%`,
                    background: "var(--green)",
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "var(--green-soft)",
                color: "var(--green)",
                padding: "10px 16px",
                borderRadius: 14,
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon name="check-circle" size={16} />
              <span>You have unlocked FREE delivery on this order!</span>
            </div>
          )}

          {/* Line items */}
          <div className="card" style={{ padding: "8px 16px" }}>
            {lines.map((item) => (
              <div
                key={item.variantId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 12,
                    background: "var(--yellow-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Icon name="package" size={24} color="var(--faint)" />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{item.name}</h4>
                  <p style={{ fontSize: 12, color: "var(--muted)" }}>{item.label}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{rupees(item.price)}</span>
                    {item.mrp > item.price && (
                      <span style={{ fontSize: 12, color: "var(--muted)", textDecoration: "line-through" }}>
                        {rupees(item.mrp)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="stepper">
                  <button className="stepper-btn" onClick={() => remove(item.variantId)}>
                    <Icon name="minus" size={14} color="#ffffff" />
                  </button>
                  <span className="stepper-qty">{item.qty}</span>
                  <button
                    className="stepper-btn"
                    disabled={item.qty >= item.maxQty}
                    onClick={() => inc(item.variantId)}
                  >
                    <Icon name="plus" size={14} color="#ffffff" />
                  </button>
                </div>

                <button onClick={() => removeLine(item.variantId)} style={{ color: "var(--faint)", padding: 6 }}>
                  <Icon name="trash-2" size={18} />
                </button>
              </div>
            ))}
          </div>

        </div>

        {/* Right: Bill Summary & Checkout CTA */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Coupon */}
          <CouponPicker />

          {/* Bill card */}
          <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--maroon)", borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
              Bill Details
            </h3>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ color: "var(--muted)" }}>Item Total</span>
              <span>{rupees(subtotal)}</span>
            </div>

            {savings > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--green)" }}>
                <span>Product Discount</span>
                <span>-{rupees(savings)}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ color: "var(--muted)" }}>Delivery Fee</span>
              <span><span style={{ color: "var(--muted)", fontSize: 13 }}>Calculated at checkout</span></span>
            </div>

            <div
              style={{
                borderTop: "1.5px dashed var(--line)",
                paddingTop: 12,
                marginTop: 4,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 18,
                fontWeight: 900,
                color: "var(--ink)",
              }}
            >
              <span>Total</span>
              <span>{rupees(totalPaise)}</span>
            </div>


            {belowMin && (
              <div style={{ background: "var(--amber-soft)", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                The minimum order is {rupees(minOrder)}. Add {rupees(minOrder - subtotal)} more to check out.
              </div>
            )}
            <button
              className="btn btn-primary"
              onClick={handleCheckout}
              disabled={belowMin}
              style={{ width: "100%", padding: "16px 20px", marginTop: 8, fontSize: 16, opacity: belowMin ? 0.5 : 1 }}
            >
              Proceed to Checkout →
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
