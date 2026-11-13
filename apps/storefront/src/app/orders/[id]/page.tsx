"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { cancelOrder, getOrderGroup, reorder } from "../../../lib/api";
import { rupees } from "../../../lib/theme";
import type { OrderGroup } from "../../../lib/types";
import { useStore } from "../../../state/StoreContext";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { Modal } from "../../../components/ui/Modal";

const STEPS = [
  { key: "PLACED", label: "Placed", match: ["PLACED", "CONFIRMED"] },
  { key: "PACKING", label: "Packing", match: ["PACKING", "PACKED"] },
  { key: "OUT", label: "On the way", match: ["OUT_FOR_DELIVERY", "RIDER_ASSIGNED"] },
  { key: "DELIVERED", label: "Delivered", match: ["DELIVERED"] },
];

export default function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = use(params);
  const { setIsCartDrawerOpen } = useStore();

  const [order, setOrder] = useState<OrderGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("Changed my mind");
  const [cancelling, setCancelling] = useState(false);
  const [reordering, setReordering] = useState(false);

  const fetchOrder = () => {
    getOrderGroup(groupId)
      .then((res) => setOrder(res))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrder();
  }, [groupId]);

  if (loading) {
    return (
      <main className="page-container" style={{ padding: "40px 16px", maxWidth: 760, margin: "0 auto" }}>
        <div className="skeleton" style={{ height: 300, borderRadius: 8 }} />
      </main>
    );
  }

  if (!order) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "60px 16px" }}>
        <h2 className="title">Order not found</h2>
        <Link href="/account/orders" className="btn btn-primary" style={{ marginTop: 16 }}>
          Back to Orders
        </Link>
      </main>
    );
  }

  const child = order.children?.[0];
  const status = child?.status ?? order.status;
  const currentStep = Math.max(0, STEPS.findIndex((s) => s.match.includes(status)));
  // A customer can cancel until packing starts, including an online order that is still waiting for its payment.
  const CANCELLABLE = ["PENDING_PAYMENT", "PLACED", "CONFIRMED"];
  const cancellable = (order.children ?? []).filter((c) => CANCELLABLE.includes(c.status));
  const canCancel = cancellable.length > 0 || (!order.children?.length && CANCELLABLE.includes(status));
  const awaitingPayment = status === "PENDING_PAYMENT" && order.paymentMethod === "online";
  const isDelivered = status === "DELIVERED";

  const handleCancelOrder = async () => {
    if (cancellable.length === 0) return;
    setCancelling(true);
    try {
      // A split order has one child per delivery; cancel every one that has not started packing.
      for (const c of cancellable) await cancelOrder(c.id, cancelReason);
      setCancelModalOpen(false);
      fetchOrder();
    } catch {
      setCancelModalOpen(false);
      fetchOrder();
      alert("Could not cancel this order. Packing may have already begun.");
    } finally {
      setCancelling(false);
    }
  };

  const handleReorder = async () => {
    if (!child) return;
    setReordering(true);
    try {
      await reorder(child.id);
      setIsCartDrawerOpen(true);
    } catch {
      alert("Could not reorder items.");
    } finally {
      setReordering(false);
    }
  };

  return (
    <main className="page-container" style={{ padding: "20px 16px 60px", maxWidth: 760, margin: "0 auto" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/account/orders" style={{ color: "var(--maroon)", display: "flex" }}>
            <Icon name="arrow-left" size={20} />
          </Link>
          <div>
            <h1 className="title" style={{ fontSize: 20 }}>
              Order #{order.groupNo || order.id.slice(-6)}
            </h1>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Placed on {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>

        {child && !isDelivered && (
          <Link
            href={`/tracking/${child.id}?group=${order.id}`}
            className="btn btn-primary"
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            Track Live →
          </Link>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Status Tracker & Timeline */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--maroon)", textTransform: "uppercase" }}>
              Delivery Status
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: isDelivered ? "var(--green)" : "var(--maroon)",
                background: isDelivered ? "var(--green-soft)" : "var(--yellow-soft)",
                padding: "3px 10px",
                borderRadius: 8,
              }}
            >
              {status.replace(/_/g, " ")}
            </span>
          </div>

          {/* Stepper timeline */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
            {STEPS.map((st, i) => (
              <div key={st.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 2 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: i <= currentStep ? "var(--maroon)" : "var(--cream-deep)",
                    color: i <= currentStep ? "var(--yellow)" : "var(--muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 12,
                  }}
                >
                  {i < currentStep ? "✓" : i + 1}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: i <= currentStep ? "var(--ink)" : "var(--muted)", marginTop: 6 }}>
                  {st.label}
                </span>
              </div>
            ))}
          </div>

          {/* 4-digit Delivery PIN */}
          {order.deliveryOtp && !isDelivered && (
            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: "var(--yellow-soft)",
                borderRadius: 14,
                border: "1px dashed var(--amber)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--maroon)", textTransform: "uppercase" }}>
                  DELIVERY PIN CODE
                </span>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Share this 4-digit PIN with your rider
                </p>
              </div>
              <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 4, color: "var(--maroon)" }}>
                {order.deliveryOtp}
              </span>
            </div>
          )}
        </div>

        {/* Rider Info Card (if assigned) */}
        {child?.rider && (
          <div className="card" style={{ padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                <Icon name="user" size={22} color="var(--maroon)" />
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                  Delivery Partner
                </span>
                <h4 style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{child.rider.name}</h4>
              </div>
            </div>

            <a
              href={`tel:${child.rider.phone}`}
              className="btn btn-outline"
              style={{ padding: "8px 16px", fontSize: 13, gap: 6 }}
            >
              <Icon name="phone" size={15} />
              <span>Call</span>
            </a>
          </div>
        )}

        {/* Ordered Items List */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--maroon)", borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 14 }}>
            Items in this order
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {order.children?.flatMap((c) => c.items ?? []).map((item) => (
              <div
                key={item.variantId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingBottom: 12,
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      background: "var(--yellow-soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <Icon name="package" size={20} color="var(--faint)" />
                    )}
                  </div>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{item.name}</h4>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {item.variantLabel} · Qty: {item.qty}
                    </span>
                  </div>
                </div>

                <span style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
                  {rupees(item.lineTotal)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bill Summary */}
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--maroon)", borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 6 }}>
            Bill Breakdown
          </h3>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span style={{ color: "var(--muted)" }}>Items Subtotal</span>
            <span>{rupees(order.pricing.subtotal)}</span>
          </div>

          {order.pricing.discount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--green)" }}>
              <span>Discounts</span>
              <span>-{rupees(order.pricing.discount)}</span>
            </div>
          )}

          {order.pricing.charges?.map((ch) => (
            <div key={ch.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ color: "var(--muted)" }}>{ch.label}</span>
              <span>{ch.amount === 0 ? "FREE" : rupees(ch.amount)}</span>
            </div>
          ))}

          <div
            style={{
              borderTop: "1.5px dashed var(--line)",
              paddingTop: 10,
              marginTop: 4,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 17,
              fontWeight: 900,
              color: "var(--ink)",
            }}
          >
            <span>Total Paid ({order.paymentMethod === "cod" ? "COD" : "Online"})</span>
            <span>{rupees(order.pricing.total)}</span>
          </div>
        </div>

        {/* Delivery Address */}
        <div className="card" style={{ padding: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--maroon)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Delivered To
          </span>
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{order.address.contactName}</p>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            {order.address.line1}, Landmark: {order.address.landmark}, {order.address.locality} - {order.address.pincode}
          </p>
        </div>

        {/* Action Buttons: Cancel, Reorder, Refund */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {awaitingPayment && (
            <Link href={`/pay/${order.id}`} className="btn btn-primary">
              Pay Now
            </Link>
          )}

          {canCancel && (
            <button
              onClick={() => setCancelModalOpen(true)}
              className="btn btn-outline"
              style={{ color: "var(--red)", borderColor: "var(--red)" }}
            >
              Cancel Order
            </button>
          )}

          {isDelivered && (
            <>
              <button
                onClick={handleReorder}
                disabled={reordering}
                className="btn btn-primary"
              >
                {reordering ? "Adding to Cart..." : "Reorder All Items"}
              </button>

              <Link href={`/orders/${order.id}/refund`} className="btn btn-outline">
                Report a Problem / Refund
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Cancel Order Modal */}
      <Modal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancel this order?"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Please tell us why you want to cancel this order:
          </p>

          <select
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
          >
            <option value="Changed my mind">Changed my mind</option>
            <option value="Ordered by mistake">Ordered by mistake</option>
            <option value="Taking too long">Taking too long</option>
            <option value="Wrong delivery address">Wrong delivery address</option>
          </select>

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <Button
              variant="outline"
              onClick={() => setCancelModalOpen(false)}
              style={{ flex: 1 }}
            >
              Keep Order
            </Button>
            <Button
              variant="primary"
              onClick={handleCancelOrder}
              loading={cancelling}
              style={{ flex: 1, background: "var(--red)", borderColor: "var(--red)" }}
            >
              Confirm Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
