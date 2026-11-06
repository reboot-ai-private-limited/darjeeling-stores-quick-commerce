import { createHmac } from "node:crypto";
import { checkoutSignature, verifyCheckout, verifyWebhook, type ProviderCapture } from "../../../src/modules/payments/payments.public.js";
import type { PaymentProvider } from "../../../src/modules/payments/payments.public.js";

export const KEY_SECRET = "test-key-secret";
export const WEBHOOK_SECRET = "test-webhook-secret";

/** Razorpay held in memory. Signatures are the real ones, made with test secrets, so the checks run as they would in production. */
export function createFakePayments() {
  const orders: { id: string; amount: number; receipt: string }[] = [];
  const links: { id: string; amount: number; reference: string; url: string }[] = [];
  const captures: ProviderCapture[] = [];
  const state = { fail: false };
  let counter = 0;
  const provider: PaymentProvider = {
    keyId: "rzp_test_key",
    async createOrder({ amount, receipt }) {
      if (state.fail) throw new Error("provider is down");
      const order = { id: `order_${++counter}`, amount, receipt };
      orders.push(order);
      return { id: order.id };
    },
    verifyCheckout: (orderId, paymentId, signature) => verifyCheckout(orderId, paymentId, signature, KEY_SECRET),
    verifyWebhook: (raw, signature) => verifyWebhook(raw, signature, WEBHOOK_SECRET),
    async createPaymentLink({ amount, reference }) {
      const link = { id: `plink_${++counter}`, amount, reference, url: `https://rzp.io/i/${counter}` };
      links.push(link);
      return { id: link.id, url: link.url, upiIntentUrl: `upi://pay?pa=shop@bank&am=${amount / 100}&tn=${reference}` };
    },
    async capturesOn() { return captures.map(c => ({ ...c })); },
  };
  return {
    provider, orders, links, captures, state,
    sign: (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"),
    checkoutSignature: (orderId: string, paymentId: string) => checkoutSignature(orderId, paymentId, KEY_SECRET),
    reset() { orders.length = 0; links.length = 0; captures.length = 0; state.fail = false; counter = 0; },
  };
}
export type FakePayments = ReturnType<typeof createFakePayments>;
