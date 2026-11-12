"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { getPaymentStatus, retryPayment, verifyPayment } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";

export default function PaymentStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = use(params);
  const router = useRouter();

  const [status, setStatus] = useState<string>("confirming");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let active = true;

    const check = async () => {
      try {
        const res = await getPaymentStatus(groupId);
        if (!active) return;

        setStatus(res.state);

        if (res.state === "confirmed") {
          router.replace(`/order-placed?id=${groupId}`);
        } else if (res.state === "failed") {
          setErrorMsg("Payment failed or was cancelled. You can try again.");
        } else if (res.state === "expired") {
          setErrorMsg("Payment session expired. Your items have been returned to the store.");
        }
      } catch {
        /* keep polling */
      }
    };

    void check();
    const timer = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [groupId, router]);

  const handleRetry = async () => {
    setRetrying(true);
    setErrorMsg(null);
    try {
      const checkoutData = await retryPayment(groupId);
      if (window.Razorpay) {
        const rzp = new window.Razorpay({
          key: checkoutData.razorpayKeyId,
          order_id: checkoutData.razorpayOrderId,
          amount: checkoutData.amount,
          currency: checkoutData.currency,
          name: "Darjeeling Stores",
          theme: { color: "#401815" },
          handler: async (resp: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await verifyPayment(groupId, {
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              });
              setStatus("confirming");
            } catch {
              setStatus("failed");
            }
          },
        });
        rzp.open();
      }
    } catch {
      setErrorMsg("Could not initiate payment retry. Please try again.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main className="page-container" style={{ textAlign: "center", padding: "80px 16px", maxWidth: 480, margin: "0 auto" }}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      {status === "confirming" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              border: "4px solid var(--cream-deep)",
              borderTopColor: "var(--maroon)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <h2 className="title">Confirming your payment...</h2>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Please wait while we verify transaction details with your bank and confirm your fresh groceries order.
          </p>
        </div>
      )}

      {status === "failed" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--red-soft)",
              color: "var(--red)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="alert-triangle" size={32} color="var(--red)" />
          </div>
          <h2 className="title">Payment Unsuccessful</h2>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            {errorMsg ?? "Your payment was not completed. Your items are safe for the next few minutes."}
          </p>

          <Button
            variant="primary"
            onClick={handleRetry}
            loading={retrying}
            style={{ width: "100%", padding: "14px", marginTop: 8 }}
          >
            Try Payment Again
          </Button>

          <Link href={`/orders/${groupId}`} style={{ fontSize: 14, fontWeight: 700, color: "var(--maroon)", marginTop: 8 }}>
            View Order Details →
          </Link>
        </div>
      )}

      {status === "expired" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--cream-deep)",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="clock" size={32} />
          </div>
          <h2 className="title">Payment Window Ended</h2>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            This payment session timed out and the order was cancelled. Your items are back in the store so you can order again anytime.
          </p>

          <Link href="/" className="btn btn-primary" style={{ padding: "12px 28px", marginTop: 12 }}>
            Return to Store
          </Link>
        </div>
      )}
    </main>
  );
}
