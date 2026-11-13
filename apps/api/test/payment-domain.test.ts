import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkoutSignature, verifyCheckout, verifyWebhook } from "../src/modules/payments/domain/payment.js";
import { createRazorpayProvider, razorpayFromEnv, unconfiguredProvider } from "../src/modules/payments/infrastructure/razorpay-provider.js";

describe("Razorpay signatures", () => {
  it("checks the checkout signature of order and payment", () => {
    const sig = checkoutSignature("order_1", "pay_1", "secret");
    expect(sig).toBe(createHmac("sha256", "secret").update("order_1|pay_1").digest("hex"));
    expect(verifyCheckout("order_1", "pay_1", sig, "secret")).toBe(true);
    expect(verifyCheckout("order_1", "pay_2", sig, "secret")).toBe(false);
    expect(verifyCheckout("order_2", "pay_1", sig, "secret")).toBe(false);
    expect(verifyCheckout("order_1", "pay_1", sig, "other")).toBe(false);
    expect(verifyCheckout("order_1", "pay_1", "", "secret")).toBe(false);
    expect(verifyCheckout("order_1", "pay_1", sig.slice(0, -1), "secret")).toBe(false);
  });
  it("checks the webhook signature over the raw body", () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const sig = createHmac("sha256", "hook").update(raw).digest("hex");
    expect(verifyWebhook(raw, sig, "hook")).toBe(true);
    expect(verifyWebhook(Buffer.from('{"event":"payment.failed"}'), sig, "hook")).toBe(false);
    expect(verifyWebhook(raw, sig, "wrong")).toBe(false);
    expect(verifyWebhook(undefined, sig, "hook")).toBe(false);
    expect(verifyWebhook(raw, undefined, "hook")).toBe(false);
  });
});

describe("the Razorpay connection", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const respond = (body: unknown, ok = true) => (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return { ok, status: ok ? 200 : 500, json: async () => body } as Response; }) as typeof fetch;
  const make = (fetchImpl: typeof fetch) => createRazorpayProvider({ keyId: "rzp_key", keySecret: "sec", webhookSecret: "hook", baseUrl: "https://rzp.test/v1", fetch: fetchImpl });

  it("makes an order with the amount in paise and basic authentication", async () => {
    calls.length = 0;
    const provider = make(respond({ id: "order_9" }));
    expect(await provider.createOrder({ amount: 16500, receipt: "DS-240001", notes: { groupId: "g" } })).toEqual({ id: "order_9" });
    expect(calls[0]!.url).toBe("https://rzp.test/v1/orders");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ amount: 16500, currency: "INR", receipt: "DS-240001", notes: { groupId: "g" } });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("rzp_key:sec").toString("base64")}`);
    expect(provider.keyId).toBe("rzp_key");
  });
  it("makes a payment link that ends at a given time", async () => {
    calls.length = 0;
    const provider = make(respond({ id: "plink_1", short_url: "https://rzp.io/i/abc" }));
    const link = await provider.createPaymentLink({ amount: 5000, reference: "DS-1", description: "Order DS-1", expiresAt: new Date("2026-11-05T12:00:00Z"), customer: { name: "Asha", phone: "+919876543210" } });
    expect(link).toEqual({ id: "plink_1", url: "https://rzp.io/i/abc", upiIntentUrl: null });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ amount: 5000, accept_partial: false, reference_id: "DS-1", expire_by: 1_793_880_000, upi_link: true, customer: { name: "Asha", contact: "+919876543210" } });
  });
  it("lists a day's payments", async () => {
    calls.length = 0;
    const provider = make(respond({ items: [{ id: "pay_1", order_id: "order_1", amount: 100, status: "captured" }] }));
    expect(await provider.capturesOn(new Date("2026-11-05T00:00:00Z"), new Date("2026-11-06T00:00:00Z"))).toEqual([{ paymentId: "pay_1", orderId: "order_1", amount: 100, status: "captured" }]);
    expect(calls[0]!.url).toContain("/payments?from=1793836800&to=1793923200&count=100&skip=0");
  });
  it("refunds a payment through Razorpay once, using the key to stop a repeat", async () => {
    calls.length = 0;
    const provider = make(respond({ id: "rfnd_1" }));
    expect(await provider.refund({ paymentId: "pay_9", amount: 4000, key: "refund-abc", notes: { groupId: "g" } })).toEqual({ id: "rfnd_1" });
    expect(calls[0]!.url).toContain("/payments/pay_9/refund");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Refund-Idempotency"]).toBe("refund-abc");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ amount: 4000, speed: "normal", notes: { groupId: "g" } });
    await expect(unconfiguredProvider.refund({ paymentId: "p", amount: 1, key: "k" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
  it("says the service is unavailable when it fails or cannot be reached", async () => {
    await expect(make(respond({}, false)).createOrder({ amount: 1, receipt: "r" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(make((async () => { throw new Error("offline"); }) as unknown as typeof fetch).createOrder({ amount: 1, receipt: "r" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
  it("is replaced by a provider that refuses everything when it is not set up", async () => {
    expect(razorpayFromEnv({})).toBe(unconfiguredProvider);
    expect(razorpayFromEnv({ RAZORPAY_KEY_ID: "a", RAZORPAY_KEY_SECRET: "b" })).toBe(unconfiguredProvider);
    expect(razorpayFromEnv({ RAZORPAY_KEY_ID: "a", RAZORPAY_KEY_SECRET: "b", RAZORPAY_WEBHOOK_SECRET: "c" })).not.toBe(unconfiguredProvider);
    await expect(unconfiguredProvider.createOrder({ amount: 1, receipt: "r" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(unconfiguredProvider.verifyWebhook(Buffer.from("x"), "y")).toBe(false);
  });
});
