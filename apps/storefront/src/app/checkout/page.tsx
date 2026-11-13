"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import {
  ApiError,
  createQuote,
  getAddresses,
  getPreorderSlots,
  newIdempotencyKey,
  placeOrder,
  ensureCartSynced,
  friendlyErrorMessage,
  getTipOptions,
  verifyPayment,
} from "../../lib/api";
import { rupees } from "../../lib/theme";
import type { Address, PreorderSlot, Quote } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { AddressModal } from "../../components/address/AddressModal";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, callback: (res: unknown) => void) => void;
    };
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const {
    lines,
    subtotal,
    signedIn,
    zone,
    booting,
    storeStatus,
    setCouponCode,
    clearCart,
    applyServerCart,
    user,
    setIsLoginModalOpen,
  } = useStore();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);

  // Pre-order slots
  const [slots, setSlots] = useState<PreorderSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PreorderSlot | null>(null);
  const [isPreorder, setIsPreorder] = useState(false);

  // Instructions & Tip
  const [riderNote, setRiderNote] = useState("");
  const [tipPaise, setTipPaise] = useState(0);

  // Payment method
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "online">("online");

  // Server Quote & Loading states
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The cart was built for another zone than this address: the customer has to say yes to the changes first.
  const [zoneChange, setZoneChange] = useState<{ removed?: { name?: string }[]; repriced?: { name?: string; oldUnitPrice: number; newUnitPrice: number }[] } | null>(null);
  const [acceptZoneChange, setAcceptZoneChange] = useState(false);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [tips, setTips] = useState<{ enabled: boolean; presets: number[]; max: number } | null>(null);
  /** Bumped to ask for a fresh bill (for example after the old one expired). */
  const [requoteTick, setRequoteTick] = useState(0);

  // A different address starts the question again.
  useEffect(() => {
    setAcceptZoneChange(false);
    setZoneChange(null);
  }, [selectedAddress?.id]);

  // Load addresses & pre-order slots
  useEffect(() => {
    // Wait until the saved session has been checked, or a signed-in customer is asked to sign in again.
    if (booting) return;
    if (!signedIn) {
      setIsLoginModalOpen(true);
      return;
    }

    getAddresses()
      .then((addrs) => {
        setAddresses(addrs);
        const def = addrs.find((a) => a.isDefault) ?? addrs[0] ?? null;
        setSelectedAddress(def);
      })
      .catch((err: unknown) => setError(err instanceof Error ? `Could not load your addresses: ${err.message}` : "Could not load your addresses."));

    if (zone) {
      getPreorderSlots(zone.id)
        .then((s) => setSlots(s))
        .catch(() => setSlots([]));
    }
  }, [booting, signedIn, zone]);

  useEffect(() => {
    if (zone) getTipOptions(zone.id).then(setTips).catch(() => setTips(null));
  }, [zone]);

  // Only a change in what is in the cart (not a price refresh from the server) asks for a new bill, so the first load makes one quote, not two.
  const cartKey = lines.map((l) => `${l.variantId}:${l.qty}`).join("|");

  // Request quote whenever address, paymentMethod, tip, or slot changes
  useEffect(() => {
    if (!selectedAddress) return;

    if (lines.length === 0) return;

    let stale = false;
    setQuoting(true);
    setError(null);

    // The server prices its own copy of the cart, so send ours first; otherwise the bill is for an old cart.
    ensureCartSynced(
      lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })),
      selectedAddress.id
    )
      .then((res) => {
        if (stale) return null;
        if (res) applyServerCart(res.cart.items, res.corrections);
        if (res && res.corrections.length > 0) {
          const names = res.corrections.map((c) => lines.find((l) => l.variantId === c.variantId)?.name ?? "An item");
          setCartNotice(`We updated your cart: ${[...new Set(names)].join(", ")} ${names.length === 1 ? "was" : "were"} out of stock, limited or repriced.`);
        } else {
          setCartNotice(null);
        }
        return createQuote({
      addressId: selectedAddress.id,
      paymentMethod,
      tipAmount: tipPaise,
      acceptZoneChange,
      scheduledWindow: isPreorder && selectedSlot ? { start: selectedSlot.startTime, end: selectedSlot.endTime } : null,
    });
      })
      .then((q) => {
        if (stale || !q) return;
        setQuote(q);
        setZoneChange(null);
        // The server cart decides the coupon, so show what it priced with.
        setCouponCode(q.couponCode ?? null);
        if (!q.payment.codAllowed && paymentMethod === "cod") {
          setPaymentMethod("online");
        }
      })
      .catch((err: unknown) => {
        if (stale) return;
        if (err instanceof ApiError && err.code === "ZONE_CHANGE_UNCONFIRMED") {
          setQuote(null);
          setZoneChange((err.details?.zoneChange as typeof zoneChange) ?? {});
          return;
        }
        setError(err instanceof Error ? err.message : "Could not calculate prices.");
      })
      .finally(() => {
        if (!stale) setQuoting(false);
      });

    return () => {
      stale = true;
    };
  }, [selectedAddress, paymentMethod, tipPaise, isPreorder, selectedSlot, acceptZoneChange, cartKey, requoteTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlaceOrder = async () => {
    if (!quote || !selectedAddress) return;

    setPlacing(true);
    setError(null);
    const idempotencyKey = newIdempotencyKey();

    try {
      // Online orders are paid right here. Make sure the payment window can open before the order (and its stock hold) is created.
      if (paymentMethod === "online") {
        for (let i = 0; i < 50 && !window.Razorpay; i++) await new Promise((r) => setTimeout(r, 100));
        if (!window.Razorpay) {
          setPlacing(false);
          setError("The payment window could not load. Check your connection and try again.");
          return;
        }
      }

      const res = await placeOrder(
        {
          quoteId: quote.id,
          paymentMethod,
          deliveryNotes: riderNote.trim() || null,
        },
        idempotencyKey
      );

      clearCart();

      // If COD or no online payment needed
      if (paymentMethod === "cod") {
        router.push(`/order-placed?id=${res.group.id}`);
        return;
      }
      // An online order is never "placed" until it is paid. If the payment could not be started, the pay page tries again.
      if (!res.payment) {
        router.push(`/pay/${res.group.id}`);
        return;
      }

      // Online Razorpay Payment
      if (res.payment && window.Razorpay) {
        const paymentData = res.payment;
        const rzp = new window.Razorpay({
          key: paymentData.razorpayKeyId,
          order_id: paymentData.razorpayOrderId,
          amount: paymentData.amount,
          currency: paymentData.currency,
          name: "Darjeeling Stores",
          description: `Order #${res.group.groupNo}`,
          prefill: {
            name: user?.name ?? selectedAddress.contactName,
            contact: user?.phone ?? selectedAddress.contactPhone,
          },
          theme: { color: "#401815" },
          handler: async (resp: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await verifyPayment(res.group.id, {
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              });
              // The bank's answer is only provisional. The pay page waits for the server to confirm the payment, then opens "order placed".
              router.push(`/pay/${res.group.id}`);
            } catch {
              router.push(`/pay/${res.group.id}`);
            }
          },
          modal: {
            ondismiss: () => {
              router.push(`/pay/${res.group.id}`);
            },
          },
        });

        rzp.on("payment.failed", () => {
          router.push(`/pay/${res.group.id}`);
        });

        rzp.open();
      } else {
        router.push(`/pay/${res.group.id}`);
      }
    } catch (err: unknown) {
      setPlacing(false);
      if (err instanceof ApiError && err.code === "QUOTE_CHANGED" && err.details?.quote) {
        // The price moved while you were on this page: show the new bill and ask again.
        const nq = err.details.quote as Quote;
        setQuote(nq);
        setCartNotice(`The total changed to ${rupees(nq.pricing.total)}. Please check it and place the order again.`);
      } else if (err instanceof ApiError && err.code === "QUOTE_EXPIRED") {
        setCartNotice("Your bill expired, so we refreshed it. Please check it and place the order again.");
        setRequoteTick((t) => t + 1);
      } else {
        setError(err instanceof ApiError ? friendlyErrorMessage(err.code, err.message) : "Failed to place order. Please try again.");
      }
    }
  };

  if (booting) {
    return (
      <main className="page-container" style={{ padding: "24px 16px", maxWidth: 980, margin: "0 auto" }}>
        <div className="skeleton" style={{ height: 180, borderRadius: 8 }} />
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "60px 16px" }}>
        <h2 className="title" style={{ marginBottom: 12 }}>Sign in to Checkout</h2>
        <Button variant="primary" onClick={() => setIsLoginModalOpen(true)}>
          Sign In
        </Button>
      </main>
    );
  }

  if (lines.length === 0) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "60px 16px" }}>
        <h2 className="title" style={{ marginBottom: 12 }}>Your cart is empty</h2>
        <Link href="/" className="btn btn-primary">Start shopping</Link>
      </main>
    );
  }

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 980, margin: "0 auto" }}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/cart" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1 className="title" style={{ fontSize: 22 }}>Checkout & Delivery</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
        {/* Left Column: Address, Slot, Rider Note, Payment */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Selected Address Card */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="map-pin" size={18} color="var(--maroon)" />
                <span style={{ fontSize: 15, fontWeight: 800, color: "var(--maroon)" }}>Delivery Address</span>
              </div>
              <button
                onClick={() => setAddressModalOpen(true)}
                style={{ fontSize: 13, fontWeight: 700, color: "var(--maroon)" }}
              >
                {selectedAddress ? "Change" : "+ Add"}
              </button>
            </div>

            {selectedAddress ? (
              <div style={{ fontSize: 14 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ background: "var(--yellow-soft)", color: "var(--maroon)", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 4 }}>
                    {selectedAddress.label}
                  </span>
                  <span style={{ fontWeight: 700 }}>{selectedAddress.contactName} ({selectedAddress.contactPhone})</span>
                </div>
                <p style={{ color: "var(--ink)", fontWeight: 600 }}>{selectedAddress.line1}</p>
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  Landmark: {selectedAddress.landmark} · {selectedAddress.localityName ?? selectedAddress.locality ?? ""}, {selectedAddress.pincode}
                </p>
              </div>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>No address selected. Please add one to continue.</p>
            )}
          </div>

          {/* Delivery Slot Selection */}
          <div className="card" style={{ padding: 18 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--maroon)", display: "block", marginBottom: 12 }}>
              Delivery Timing
            </span>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setIsPreorder(false);
                  setSelectedSlot(null);
                }}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 700,
                  border: `1.5px solid ${!isPreorder ? "var(--maroon)" : "var(--line)"}`,
                  background: !isPreorder ? "var(--yellow-soft)" : "var(--card)",
                  color: !isPreorder ? "var(--maroon)" : "var(--ink)",
                }}
              >
                ⚡ Deliver now{storeStatus ? ` (${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} min)` : ""}
              </button>

              {slots.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPreorder(true);
                    if (slots[0]) setSelectedSlot(slots[0]);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 700,
                    border: `1.5px solid ${isPreorder ? "var(--maroon)" : "var(--line)"}`,
                    background: isPreorder ? "var(--yellow-soft)" : "var(--card)",
                    color: isPreorder ? "var(--maroon)" : "var(--ink)",
                  }}
                >
                  📅 Pre-order for later
                </button>
              )}
            </div>

            {isPreorder && slots.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Select a time slot:</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {slots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSlot(s)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        border: `1px solid ${selectedSlot?.id === s.id ? "var(--maroon)" : "var(--line)"}`,
                        background: selectedSlot?.id === s.id ? "var(--maroon)" : "var(--card)",
                        color: selectedSlot?.id === s.id ? "#ffffff" : "var(--ink)",
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Note to Rider */}
          <div className="card" style={{ padding: 18 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--maroon)", display: "block", marginBottom: 8 }}>
              Instructions for Delivery Partner
            </span>
            <input
              type="text"
              placeholder="e.g. Leave package with security guard, don't ring bell"
              value={riderNote}
              onChange={(e) => setRiderNote(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--cream)",
                outline: "none",
                fontSize: 13,
              }}
            />
          </div>

          {/* Tip for the delivery partner (the server adds it to the bill) */}
          {tips?.enabled && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>Tip your delivery partner</span>
                <span className="small">· all of it goes to them</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[0, ...tips.presets].map((v) => (
                  <button
                    key={v}
                    onClick={() => setTipPaise(v)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 700,
                      border: `1.5px solid ${tipPaise === v ? "var(--maroon)" : "var(--line)"}`,
                      background: tipPaise === v ? "var(--yellow-soft)" : "var(--card)",
                      color: tipPaise === v ? "var(--maroon)" : "var(--ink)",
                    }}
                  >
                    {v === 0 ? "No tip" : rupees(v)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Payment Method Selector */}
          <div className="card" style={{ padding: 18 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--maroon)", display: "block", marginBottom: 12 }}>
              Choose Payment Method
            </span>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1.5px solid ${paymentMethod === "online" ? "var(--maroon)" : "var(--line)"}`,
                  background: paymentMethod === "online" ? "var(--yellow-soft)" : "var(--card)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="payment"
                  checked={paymentMethod === "online"}
                  onChange={() => setPaymentMethod("online")}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="credit-card" size={18} color="var(--maroon)" />
                    <span style={{ fontSize: 14, fontWeight: 800 }}>Pay Online (Razorpay)</span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    UPI (Google Pay, PhonePe, Paytm), Credit/Debit Cards & Netbanking
                  </p>
                </div>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1.5px solid ${paymentMethod === "cod" ? "var(--maroon)" : "var(--line)"}`,
                  background: paymentMethod === "cod" ? "var(--yellow-soft)" : "var(--card)",
                  cursor: quote?.payment.codAllowed ? "pointer" : "not-allowed",
                  opacity: quote?.payment.codAllowed === false ? 0.5 : 1,
                }}
              >
                <input
                  type="radio"
                  name="payment"
                  disabled={!quote?.payment.codAllowed}
                  checked={paymentMethod === "cod"}
                  onChange={() => setPaymentMethod("cod")}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="dollar-sign" size={18} color="var(--maroon)" />
                    <span style={{ fontSize: 14, fontWeight: 800 }}>Cash on Delivery</span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {!quote
                      ? !selectedAddress ? "Choose a delivery address to see if cash on delivery is available" : quoting ? "Checking cash on delivery…" : "Cash on delivery is shown once the bill is ready. See the message below if it could not be calculated"
                      : quote.payment.codAllowed
                        ? `Pay exact amount ${rupees(quote.pricing.total)} in cash at the door`
                        : quote.payment.codMaxAmount === 0
                          ? "Cash on delivery is turned off for this area"
                          : quote.payment.codMaxAmount !== undefined && quote.pricing.total > quote.payment.codMaxAmount
                            ? `Cash on delivery is available only up to ${rupees(quote.payment.codMaxAmount)}. Pay online for this order`
                            : "Cash on delivery is turned off for your account. Pay online instead"}
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Order Review & Pricing Breakdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--maroon)", borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 14 }}>
              Order Summary
            </h3>

            {/* Split order notice */}
            {quote?.split && (
              <div
                style={{
                  background: "var(--yellow-soft)",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--maroon)",
                  marginBottom: 12,
                }}
              >
                📦 Your order will arrive in 2 separate deliveries from different warehouses, with 1 single bill and delivery fee!
              </div>
            )}

            {/* Products in this order */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
              {(quote ? quote.allocation : [{ warehouseId: "local", warehouseName: "", lines: lines.map((l) => ({ variantId: l.variantId, name: l.name, variantLabel: l.label, qty: l.qty, lineTotal: l.price * l.qty })) }]).map((group, gi, all) => (
                <div key={group.warehouseId + gi}>
                  {all.length > 1 && (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--maroon)", marginBottom: 8 }}>
                      Delivery {gi + 1} · {group.warehouseName}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {group.lines.map((l) => {
                      const img = lines.find((x) => x.variantId === l.variantId)?.imageUrl;
                      return (
                        <div key={(l.variantId ?? l.name) + l.variantLabel} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 48, height: 48, borderRadius: 10, border: "1px solid var(--line)", background: "var(--white)", overflow: "hidden", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {img ? <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="package" size={20} color="var(--faint)" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>
                              {l.variantLabel} · Qty {l.qty}
                            </div>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 800 }}>{rupees(l.lineTotal)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Price breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Items Subtotal</span>
                <span>{rupees(quote?.pricing.subtotal ?? subtotal)}</span>
              </div>

              {quote && quote.pricing.discount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--green)" }}>
                  <span>Discounts Applied</span>
                  <span>-{rupees(quote.pricing.discount)}</span>
                </div>
              )}

              {!quote && selectedAddress && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Delivery fee</span>
                  <span style={{ color: "var(--muted)" }}>Calculating…</span>
                </div>
              )}

              {quote && !quote.pricing.charges.some((c) => c.type === "delivery_fee") && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Delivery fee</span>
                  <span style={{ color: "var(--green)", fontWeight: 700 }}>FREE</span>
                </div>
              )}

              {quote?.pricing.charges.map((ch) => (
                <div key={ch.label} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>{ch.label}</span>
                  <span>{ch.amount === 0 ? "FREE" : rupees(ch.amount)}</span>
                </div>
              ))}

              {quote && quote.pricing.tax > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Taxes & GST</span>
                  <span>{rupees(quote.pricing.tax)}</span>
                </div>
              )}

              <div
                style={{
                  borderTop: "1.5px dashed var(--line)",
                  paddingTop: 12,
                  marginTop: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 18,
                  fontWeight: 900,
                  color: "var(--ink)",
                }}
              >
                <span>Grand Total</span>
                <span>{rupees(quote?.pricing.total ?? subtotal)}</span>
              </div>
            </div>

            {cartNotice && (
              <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--amber-soft)", color: "var(--ink)", borderRadius: 10, fontSize: 13, fontWeight: 600 }}>{cartNotice}</div>
            )}

            {zoneChange && (
              <div style={{ marginTop: 14, padding: 14, background: "var(--amber-soft)", borderRadius: 12, border: "1px solid var(--amber)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14 }}>
                  <Icon name="info" size={16} color="var(--amber)" />
                  Prices change for this address
                </div>
                <p style={{ fontSize: 13, color: "var(--ink)", marginTop: 6 }}>
                  Your cart was built for a different delivery area. Please accept the changes to see your bill.
                </p>
                {zoneChange.removed?.map((r, i) => (
                  <p key={i} style={{ fontSize: 13, marginTop: 4 }}>
                    • {r.name ?? "An item"} isn&apos;t available there and will be removed.
                  </p>
                ))}
                {zoneChange.repriced && zoneChange.repriced.length > 0 && (
                  <p style={{ fontSize: 13, marginTop: 4 }}>
                    • {zoneChange.repriced.length} item {zoneChange.repriced.length === 1 ? "price" : "prices"} will change.
                  </p>
                )}
                <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={() => setAcceptZoneChange(true)} disabled={quoting}>
                  Accept changes
                </button>
              </div>
            )}

            {error && (
              <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--red-soft)", color: "var(--red)", borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
                {error}
              </div>
            )}

            {selectedAddress ? (
              <Button
                variant="primary"
                onClick={handlePlaceOrder}
                disabled={!quote || quoting}
                loading={placing}
                style={{ width: "100%", padding: "16px 20px", marginTop: 20, fontSize: 16 }}
              >
                {paymentMethod === "cod" ? "Confirm & Place COD Order" : `Pay ${rupees(quote?.pricing.total ?? subtotal)} & Place Order`}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => setAddressModalOpen(true)}
                style={{ width: "100%", padding: "16px 20px", marginTop: 20, fontSize: 16 }}
              >
                Add delivery address to continue
              </Button>
            )}
          </div>
        </div>
      </div>

      <AddressModal
        isOpen={addressModalOpen}
        onClose={() => setAddressModalOpen(false)}
        onSuccess={(saved) => setSelectedAddress(saved)}
      />
    </main>
  );
}
