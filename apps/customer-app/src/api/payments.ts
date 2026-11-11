import { api, ApiError } from "./http";
import { newKey } from "./orders";

/** What Razorpay checkout needs. Comes with the placed order, or from `retryPayment`. */
export type CheckoutData = { razorpayKeyId: string; razorpayOrderId: string; amount: number; currency: string; expiresAt: string };
export type PaymentState = "awaiting_payment" | "confirming" | "confirmed" | "failed" | "expired";
export type PaymentStatus = { groupId: string; paymentStatus: string; state: PaymentState; expiresAt?: string | null };
export type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

/** Starts a new payment attempt. The order stays open until its payment window ends. */
export const retryPayment = (groupId: string) => api<CheckoutData>("POST", "/payments/retry", { groupId }).then(r => r.data);

/** Tells the server what checkout returned. This is only a provisional check: the webhook is what confirms the order. */
export const verifyPayment = (groupId: string, r: RazorpaySuccess) =>
  api<{ state: string }>("POST", "/payments/verify", { groupId, razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpaySignature: r.razorpay_signature }, { headers: { "Idempotency-Key": newKey() } }).then(r2 => r2.data);

export const getPaymentStatus = (groupId: string) => api<PaymentStatus>("GET", `/order-groups/${groupId}/payment`).then(r => r.data);

/** Plain words for payment errors. */
export const paymentMessage = (e: unknown): string => {
  if (e instanceof ApiError) {
    if (e.code === "PAYMENT_EXPIRED") return "The payment window ended and this order was cancelled. Your items are back in the store, so you can order again.";
    if (e.code === "SERVICE_UNAVAILABLE") return "Online payment isn't available right now. Please try again in a moment.";
    if (e.code === "CONFLICT") return "This order is already paid.";
    if (e.code === "PAYMENT_MISMATCH") return "We couldn't match that payment to your order. If money was taken, it will be refunded.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong with the payment.";
};

/** The page Razorpay's standard checkout runs in. It reports back to the app through postMessage. */
export const checkoutHtml = (c: CheckoutData, prefill: { name?: string; phone?: string }) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#f7f3ea;font-family:sans-serif;display:flex;align-items:center;justify-content:center;color:#7a6f66}</style></head><body><div>Opening secure payment…</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
function send(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
try{
  var rzp=new Razorpay({
    key:${JSON.stringify(c.razorpayKeyId)}, order_id:${JSON.stringify(c.razorpayOrderId)}, amount:${c.amount}, currency:${JSON.stringify(c.currency)},
    name:"Darjeeling Stores", prefill:{name:${JSON.stringify(prefill.name ?? "")},contact:${JSON.stringify(prefill.phone ?? "")}},
    theme:{color:"#401815"},
    handler:function(r){send({type:"success",data:r});},
    modal:{ondismiss:function(){send({type:"dismissed"});}}
  });
  rzp.on("payment.failed",function(r){send({type:"failed",reason:(r&&r.error&&r.error.description)||"Payment failed"});});
  rzp.open();
}catch(e){send({type:"error",reason:String(e)});}
</script></body></html>`;
