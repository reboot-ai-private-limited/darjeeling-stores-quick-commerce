import { AppError } from "../../catalog/catalog.public.js";
import { verifyCheckout, verifyWebhook, type ProviderCapture } from "../domain/payment.js";
import type { PaymentProvider } from "../application/ports.js";

export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret: string; baseUrl?: string; fetch?: typeof fetch }

/** Razorpay over its REST API. Amounts are paise, which is what Razorpay uses too. */
export function createRazorpayProvider(config: RazorpayConfig): PaymentProvider {
  const base = config.baseUrl ?? "https://api.razorpay.com/v1";
  const call = config.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
  async function api<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
    let response: Response;
    try {
      response = await call(`${base}${path}`, {
        method: init.method ?? "GET", headers: { Authorization: auth, "Content-Type": "application/json" },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }), signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new AppError("SERVICE_UNAVAILABLE", "The payment service is not reachable. Please try again."); }
    if (!response.ok) throw new AppError("SERVICE_UNAVAILABLE", "The payment service refused the request. Please try again.", { status: response.status });
    return (await response.json()) as T;
  }
  return {
    keyId: config.keyId,
    async createOrder({ amount, receipt, notes }) {
      const order = await api<{ id: string }>("/orders", { method: "POST", body: { amount, currency: "INR", receipt, ...(notes && { notes }) } });
      return { id: order.id };
    },
    verifyCheckout: (orderId, paymentId, signature) => verifyCheckout(orderId, paymentId, signature, config.keySecret),
    verifyWebhook: (rawBody, signature) => verifyWebhook(rawBody, signature, config.webhookSecret),
    async createPaymentLink({ amount, reference, description, expiresAt, customer }) {
      const link = await api<{ id: string; short_url: string }>("/payment_links", {
        method: "POST", body: {
          amount, currency: "INR", accept_partial: false, reference_id: reference, description, expire_by: Math.floor(expiresAt.getTime() / 1000),
          customer: { name: customer.name, contact: customer.phone }, notify: { sms: false, email: false }, upi_link: true,
        },
      });
      return { id: link.id, url: link.short_url, upiIntentUrl: link.short_url.startsWith("upi://") ? link.short_url : null };
    },
    async capturesOn(from, to) {
      const out: ProviderCapture[] = [];
      for (let skip = 0; skip < 5000; skip += 100) {
        const page = await api<{ items: { id: string; order_id: string | null; amount: number; status: string }[] }>(`/payments?from=${Math.floor(from.getTime() / 1000)}&to=${Math.floor(to.getTime() / 1000)}&count=100&skip=${skip}`);
        out.push(...page.items.map(p => ({ paymentId: p.id, orderId: p.order_id, amount: p.amount, status: p.status })));
        if (page.items.length < 100) break;
      }
      return out;
    },
  };
}

/** The payments are not set up: every attempt says so instead of failing in a confusing way. */
export const unconfiguredProvider: PaymentProvider = {
  keyId: "",
  createOrder: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Online payment is not set up yet"); },
  verifyCheckout: () => false,
  verifyWebhook: () => false,
  createPaymentLink: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Online payment is not set up yet"); },
  capturesOn: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Online payment is not set up yet"); },
};

export function razorpayFromEnv(env: Record<string, string | undefined>): PaymentProvider {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret, RAZORPAY_WEBHOOK_SECRET: webhookSecret } = env;
  return keyId && keySecret && webhookSecret ? createRazorpayProvider({ keyId, keySecret, webhookSecret }) : unconfiguredProvider;
}
