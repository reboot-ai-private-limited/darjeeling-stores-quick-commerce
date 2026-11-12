import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "../../src/modules/notifications/notifications.public.js";
import { CUSTOMER_A, CUSTOMER_B, CUSTOMER_C, W1, ZONE1, ZONE2, admin, customer, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { api } from "./support/harness.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("notifications_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const A = CUSTOMER_A;
const B = CUSTOMER_B;
const C = CUSTOMER_C;
const PHONE_A = "+919800000001";
const PHONE_B = "+919800000002";
const col = (name: string) => f.h.connection.collection(name);
const note = (id: string) => col("notifications").findOne({ _id: id as never });
const allNotes = () => col("notifications").find({}).sort({ _id: 1 }).toArray();
const makeDue = () => col("jobs").updateMany({ status: "pending" }, { $set: { runAt: new Date(0) } });
const notify = f2(() => f.mods.notifications.notify);
function f2<T>(get: () => T): T { return ((...args: unknown[]) => (get() as unknown as (...a: unknown[]) => unknown)(...args)) as unknown as T; }

/** A built-in message that goes out on both push and WhatsApp: "refund paid". */
const confirmed = (userId: string, extra: Record<string, unknown> = {}) => notify({
  userId, templateKey: "customer_refund_done", vars: { orderNo: "DS-240001-A", amount: 399 },
  data: { type: "order_status", orderId: "ord_1", deepLink: "ds://order/ord_1" }, ...extra,
});

describe("queuing and sending", () => {
  it("fills in the templates, saves one log row per channel, and sends them when the worker runs", async () => {
    f.msg.person(A, PHONE_A, ["tok-1"]);
    const result = await confirmed(A, { orderId: "e1".repeat(12), imageUrl: "https://cdn/x.webp" });
    expect(result.queued.map(q => q.channel).sort()).toEqual(["push", "whatsapp"]);
    expect(result.skipped).toEqual([]);

    const rows = await allNotes();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.status === "queued" && r.attempts === 0 && r.userId === A && r.orderId === "e1".repeat(12))).toBe(true);
    expect(await col("jobs").countDocuments({ type: "notification.send", status: "pending" })).toBe(2);
    expect(f.msg.pushed).toHaveLength(0);

    expect(await f.runJobs()).toBe(2);
    expect(f.msg.pushed).toEqual([{
      token: "tok-1", title: "Refund paid", body: "Your refund of ₹399 for order DS-240001-A has been paid.", imageUrl: "https://cdn/x.webp", priority: "high",
      data: { type: "order_status", orderId: "ord_1", deepLink: "ds://order/ord_1", notificationId: result.queued.find(q => q.channel === "push")!.id },
    }]);
    expect(f.msg.whatsapped).toEqual([{ to: PHONE_A, templateName: "refund_done_v1", language: "en", params: ["399", "DS-240001-A"], buttonParams: [] }]);
    for (const row of await allNotes()) expect(row).toMatchObject({ status: "sent", attempts: 1, error: null, sentAt: expect.any(Date), lockedUntil: null });
    expect((await allNotes()).map(r => r.providerMessageId).sort()).toEqual(["fcm-1", "wamid.1"]);
    expect(await col("jobs").countDocuments({ status: "done" })).toBe(2);
  });

  it("sends only the channels asked for, and SMS only when asked", async () => {
    f.msg.person(A, PHONE_A, ["tok-1"]);
    const only = await confirmed(A, { channels: ["whatsapp"] });
    expect(only.queued.map(q => q.channel)).toEqual(["whatsapp"]);
    const sms = await confirmed(A, { channels: ["sms"], dedupeKey: "x" });
    expect(sms.skipped).toEqual([{ channel: "sms", reason: "no_template" }]);
    const texted = await notify({ userId: A, templateKey: "otp_login", channels: ["sms"], vars: { code: "482913" }, dedupeKey: "y" });
    expect(texted.queued.map(q => q.channel)).toEqual(["sms"]);
    await f.runJobs();
    expect(f.msg.texted).toEqual([{ to: PHONE_A, text: "Your Darjeeling Stores login code is 482913. Valid for 5 minutes." }]);
    expect(f.msg.pushed).toHaveLength(0);
  });

  it("skips channels a message has no wording for, and refuses to send with a value missing", async () => {
    const none = await notify({ userId: A, templateKey: "no_such_template" });
    expect(none).toEqual({ queued: [], skipped: [{ channel: "push", reason: "no_template" }, { channel: "whatsapp", reason: "no_template" }] });
    const missing = notify({ userId: A, templateKey: "customer_refund_done", vars: { orderNo: "DS-1" } });
    await expect(missing).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { field: "vars", variable: "amount" } });
    expect(await col("notifications").countDocuments({})).toBe(0);
    // "order placed" has push wording only, so WhatsApp is skipped.
    const placed = await notify({ userId: A, templateKey: "customer_order_placed", vars: { orderNo: "DS-1" } });
    expect(placed.queued.map(q => q.channel)).toEqual(["push"]);
    expect(placed.skipped).toEqual([{ channel: "whatsapp", reason: "no_template" }]);
  });

  it("queues a message once however many times the same event is reported", async () => {
    f.msg.person(A, PHONE_A, ["tok-1"]);
    const first = await confirmed(A, { dedupeKey: "order:ord_1:confirmed" });
    const again = await confirmed(A, { dedupeKey: "order:ord_1:confirmed" });
    expect(first.queued).toHaveLength(2);
    expect(again.queued).toEqual([]);
    expect(again.skipped.map(s => s.reason)).toEqual(["duplicate", "duplicate"]);
    await Promise.all([1, 2, 3].map(() => confirmed(A, { dedupeKey: "order:ord_1:confirmed" })));
    await f.runJobs();
    expect(await col("notifications").countDocuments({})).toBe(2);
    expect(f.msg.pushed).toHaveLength(1);
    expect(f.msg.whatsapped).toHaveLength(1);
  });

  it("respects promo preferences but never holds back order updates", async () => {
    const offer = { title: "Weekend offer", body: "Free delivery today" };
    const promo = (userId: string) => notify({ userId, templateKey: "promo_broadcast", vars: offer, purpose: "promo" });
    expect((await promo(A)).queued.map(q => q.channel)).toEqual(["push"]);
    await f.mods.notifications.delivery.setPrefs(B, { promoPush: false, promoWhatsApp: true });
    const b = await promo(B);
    expect(b.queued.map(q => q.channel)).toEqual(["whatsapp"]);
    expect(b.skipped).toEqual([{ channel: "push", reason: "opted_out" }]);
    await f.mods.notifications.delivery.setPrefs(C, { promoPush: false });
    expect((await promo(C)).queued).toEqual([]);
    // The same customer still gets an order update.
    expect((await confirmed(C)).queued).toHaveLength(2);
    // Cart reminders need their own opt-in.
    expect((await notify({ userId: A, templateKey: "promo_broadcast", vars: offer, purpose: "cart_reminder", dedupeKey: "c1" })).queued).toEqual([]);
    await f.mods.notifications.delivery.setPrefs(A, { cartReminders: true });
    expect((await notify({ userId: A, templateKey: "promo_broadcast", vars: offer, purpose: "cart_reminder", dedupeKey: "c2" })).queued.length).toBe(2);
  });
});

describe("when sending goes wrong", () => {
  const status = async (id: string) => (await note(id))!;
  async function one(channel: "push" | "whatsapp") {
    const { queued } = await confirmed(A, { channels: [channel] });
    return queued[0]!.id;
  }

  it("tries every device, forgets the ones that are gone, and counts it sent if any received it", async () => {
    f.msg.person(A, PHONE_A, ["gone-1", "ok-1", "gone-2", "ok-2"]);
    f.msg.behavior.pushByToken.set("gone-1", "invalid");
    f.msg.behavior.pushByToken.set("gone-2", "invalid");
    const id = await one("push");
    await f.runJobs();
    expect(await status(id)).toMatchObject({ status: "sent", attempts: 1 });
    expect(f.msg.pushed.map(p => p.token)).toEqual(["ok-1", "ok-2"]);
    expect(f.msg.removedTokens).toEqual(["gone-1", "gone-2"]);
  });

  it("fails at once, with the reason, when there is nowhere to send it", async () => {
    const push = await one("push");
    f.msg.person(A, PHONE_A, []);
    await f.runJobs();
    expect(await status(push)).toMatchObject({ status: "failed", error: "No registered device for this user", attempts: 1 });
    const wa = (await confirmed(B, { channels: ["whatsapp"] })).queued[0]!.id;
    await f.runJobs();
    expect(await status(wa)).toMatchObject({ status: "failed", error: "No phone number for this user" });
    expect(await col("jobs").countDocuments({ status: "done" })).toBe(2);
    expect(f.msg.pushed).toHaveLength(0);
  });

  it("fails at once when every device turns out to be gone", async () => {
    f.msg.person(A, PHONE_A, ["x"]);
    f.msg.behavior.pushByToken.set("x", "invalid");
    const id = await one("push");
    await f.runJobs();
    expect(await status(id)).toMatchObject({ status: "failed", error: "None of the user's devices can receive push any more" });
    expect(f.msg.removedTokens).toEqual(["x"]);
  });

  it("fails at once, without retrying, when the provider says it can never work (an unapproved template)", async () => {
    f.msg.person(A, PHONE_A);
    f.msg.behavior.whatsapp = [new ProviderError("Template name does not exist", true, "132001")];
    const id = await one("whatsapp");
    await f.runJobs();
    expect(await status(id)).toMatchObject({ status: "failed", error: "Template name does not exist", attempts: 1 });
    expect(await col("jobs").countDocuments({ status: "done" })).toBe(1);
    await makeDue();
    expect(await f.runJobs()).toBe(0);
  });

  it("keeps the message queued and tries again after a wait when the provider is only busy", async () => {
    f.msg.person(A, PHONE_A);
    f.msg.behavior.whatsapp = [new ProviderError("Rate limit hit", false, "130429"), null];
    const id = await one("whatsapp");
    await f.runJobs();
    expect(await status(id)).toMatchObject({ status: "queued", attempts: 1, error: "Rate limit hit", lockedUntil: null });
    expect(await col("jobs").countDocuments({ status: "pending", attempts: 1 })).toBe(1);
    expect(await f.runJobs()).toBe(0);
    await makeDue();
    await f.runJobs();
    expect(await status(id)).toMatchObject({ status: "sent", attempts: 2, error: null });
    expect(f.msg.whatsapped).toHaveLength(1);
  });

  it("gives up after five tries and says so in the log", async () => {
    f.msg.person(A, PHONE_A);
    f.msg.behavior.whatsappAlways = new ProviderError("WhatsApp is down", false);
    const id = await one("whatsapp");
    for (let i = 0; i < 5; i++) { await f.runJobs(); await makeDue(); }
    expect(await status(id)).toMatchObject({ status: "failed", attempts: 5, error: "Gave up after 5 tries: WhatsApp is down" });
    expect(await col("jobs").countDocuments({ status: "failed" })).toBe(1);
    expect(await f.runJobs()).toBe(0);
  });

  it("says plainly that a provider is not set up", async () => {
    const bare = await import("../../src/composition/dev2.js").then(m => m.createDev2Modules({ connection: f.h.connection, auth: () => undefined, contacts: f.msg.contacts, devices: f.msg.devices }));
    await bare.notifications.ready();
    f.msg.person(A, PHONE_A, ["t"]);
    const { queued } = await bare.notifications.notify({ userId: A, templateKey: "customer_refund_done", vars: { orderNo: "DS-1", amount: 10 }, channels: ["whatsapp"] });
    for (let i = 0; i < 5; i++) await bare.jobs.service.runOnce();
    expect(await status(queued[0]!.id)).toMatchObject({ status: "failed", error: "WhatsApp is not configured on this server" });
  });

  it("never sends one message twice, even if two workers pick it up together", async () => {
    f.msg.person(A, PHONE_A);
    const id = await one("whatsapp");
    const results = await Promise.all([1, 2, 3].map(() => f.mods.notifications.delivery.deliver(id)));
    expect(results.sort()).toEqual(["sent", "skipped", "skipped"]);
    expect(f.msg.whatsapped).toHaveLength(1);
    expect(await f.mods.notifications.delivery.deliver(id)).toBe("skipped");
  });

  it("waits for a worker that is still sending, and takes over only after its hold runs out", async () => {
    f.msg.person(A, PHONE_A);
    const id = await one("whatsapp");
    expect(await f.mods.notifications.store.claim(id, new Date(), new Date(Date.now() + 60_000))).not.toBeNull();
    expect(await f.mods.notifications.delivery.deliver(id)).toBe("skipped");
    await col("notifications").updateOne({ _id: id as never }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    expect(await f.mods.notifications.delivery.deliver(id)).toBe("sent");
    expect(await status(id)).toMatchObject({ attempts: 2, status: "sent" });
  });
});

describe("the delivery log and retrying", () => {
  async function seedLog() {
    f.msg.person(A, PHONE_A, ["tok-a"]);
    f.msg.person(B, null, []);
    await confirmed(A, { orderId: "e1".repeat(12) });
    await confirmed(B, { orderId: "e2".repeat(12) });
    await f.runJobs();
  }

  it("lists newest first with the failure count, and filters by status, channel, user, order and date", async () => {
    await seedLog();
    const all = await f.get("/admin/notifications");
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(4);
    expect(all.body.meta).toEqual({ nextCursor: null, failedCount: 2 });
    const ids = all.body.data.map((n: { id: string }) => n.id);
    expect(ids).toEqual([...ids].sort().reverse());
    expect(all.body.data.find((n: { userId: string; channel: string }) => n.userId === A && n.channel === "push")).toEqual({
      id: expect.any(String), userId: A, templateKey: "customer_refund_done", channel: "push", status: "sent", error: null, attempts: 1,
      orderId: "e1".repeat(12), createdAt: expect.stringMatching(/Z$/), sentAt: expect.stringMatching(/Z$/),
    });
    const names = async (q: string) => (await f.get(`/admin/notifications?${q}`)).body.data.length;
    expect(await names("status=failed")).toBe(2);
    expect(await names("status=sent")).toBe(2);
    expect(await names("status=queued")).toBe(0);
    expect(await names("channel=push")).toBe(2);
    expect(await names(`userId=${B}`)).toBe(2);
    expect(await names(`orderId=${"e1".repeat(12)}`)).toBe(2);
    expect(await names(`from=${new Date(Date.now() + 60_000).toISOString()}`)).toBe(0);
    expect(await names(`to=${new Date(Date.now() + 60_000).toISOString()}`)).toBe(4);
    expect((await f.get(`/admin/notifications?userId=${B}&status=failed`)).body.meta.failedCount).toBe(2);
    expect((await f.get(`/admin/notifications?userId=${A}`)).body.meta.failedCount).toBe(0);
  });

  it("pages through the log", async () => {
    await seedLog();
    const first = await f.get("/admin/notifications?limit=3");
    expect(first.body.data).toHaveLength(3);
    expect(first.body.meta.nextCursor).toBe(first.body.data[2].id);
    const second = await f.get(`/admin/notifications?limit=3&cursor=${first.body.meta.nextCursor}`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.nextCursor).toBeNull();
    expect((await f.get("/admin/notifications?cursor=nope")).status).toBe(400);
    expect((await f.get("/admin/notifications?limit=0")).status).toBe(400);
    expect((await f.get("/admin/notifications?status=lost")).status).toBe(400);
  });

  it("retries a failed message once the cause is fixed", async () => {
    await seedLog();
    const failed = (await f.get(`/admin/notifications?userId=${B}&channel=whatsapp`)).body.data[0];
    expect(failed.status).toBe("failed");
    f.msg.person(B, PHONE_B, []);
    const res = await f.send("post", `/admin/notifications/${failed.id}/retry`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: failed.id, status: "queued" });
    expect(await note(failed.id)).toMatchObject({ status: "queued", error: null, attempts: 0 });
    await f.runJobs();
    expect(await note(failed.id)).toMatchObject({ status: "sent", attempts: 1 });
    expect(f.msg.whatsapped.at(-1)).toMatchObject({ to: PHONE_B });
  });

  it("refuses to retry a message that has not failed, and 404s for an unknown one", async () => {
    await seedLog();
    const sent = (await f.get("/admin/notifications?status=sent")).body.data[0];
    const res = await f.send("post", `/admin/notifications/${sent.id}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "not_failed" } });
    expect((await f.send("post", `/admin/notifications/${"9".repeat(24)}/retry`)).status).toBe(404);
    expect((await f.send("post", "/admin/notifications/nope/retry")).status).toBe(404);
  });

  it("needs the notifications permission", async () => {
    await seedLog();
    const failed = (await f.get("/admin/notifications?status=failed")).body.data[0];
    expect((await f.get("/admin/notifications", viewer)).status).toBe(403);
    expect((await f.send("post", `/admin/notifications/${failed.id}/retry`, undefined, viewer)).status).toBe(403);
    expect((await f.get("/admin/notifications", {})).status).toBe(401);
  });
});

describe("notification preferences", () => {
  it("starts with promo push on and promo WhatsApp and cart reminders off, and saves changes", async () => {
    const start = await f.get("/me/notification-prefs", customer(A));
    expect(start.status).toBe(200);
    expect(start.body.data).toEqual({ promoPush: true, promoWhatsApp: false, cartReminders: false });
    const changed = await f.send("put", "/me/notification-prefs", { promoWhatsApp: true }, customer(A));
    expect(changed.body.data).toEqual({ promoPush: true, promoWhatsApp: true, cartReminders: false });
    expect((await f.send("put", "/me/notification-prefs", { promoPush: false, cartReminders: true }, customer(A))).body.data).toEqual({ promoPush: false, promoWhatsApp: true, cartReminders: true });
    expect((await f.get("/me/notification-prefs", customer(A))).body.data).toEqual({ promoPush: false, promoWhatsApp: true, cartReminders: true });
    expect((await f.send("put", "/me/notification-prefs", {}, customer(A))).body.data).toEqual({ promoPush: false, promoWhatsApp: true, cartReminders: true });
  });

  it("keeps each customer's choices separate, and checks the input and the caller", async () => {
    await f.send("put", "/me/notification-prefs", { promoPush: false }, customer(A));
    expect((await f.get("/me/notification-prefs", customer(B))).body.data.promoPush).toBe(true);
    expect((await f.send("put", "/me/notification-prefs", { promoPush: "no" }, customer(A))).status).toBe(400);
    expect((await f.send("put", "/me/notification-prefs", { orderUpdates: false }, customer(A))).status).toBe(400);
    expect((await f.get("/me/notification-prefs", {})).status).toBe(401);
    expect((await f.send("put", "/me/notification-prefs", {}, admin)).status).toBe(401);
  });
});

describe("WhatsApp webhook", () => {
  const hook = (payload: unknown, signature?: string | null) => {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    const sig = signature === undefined ? `sha256=${createHmac("sha256", "app-secret").update(text).digest("hex")}` : signature;
    const r = request(f.app).post(`${api}/webhooks/whatsapp`).set("Content-Type", "application/json");
    return (sig === null ? r : r.set("X-Hub-Signature-256", sig)).send(text);
  };
  const report = (id: string, status: string, errors?: unknown[]) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status, ...(errors && { errors }) }] } }] }] });

  async function sentMessage() {
    f.msg.person(A, PHONE_A);
    const { queued } = await confirmed(A, { channels: ["whatsapp"] });
    await f.runJobs();
    return { id: queued[0]!.id, wamid: (await note(queued[0]!.id))!.providerMessageId as string };
  }

  it("answers the provider's set-up challenge only when the token matches", async () => {
    const challenge = (query: string) => request(f.app).get(`${api}/webhooks/whatsapp?${query}`);
    const ok = await challenge("hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444");
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("1158201444");
    expect((await challenge("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status).toBe(403);
    expect((await challenge("hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=1")).status).toBe(403);
    expect((await challenge("hub.challenge=1")).status).toBe(403);
  });

  it("moves a message from sent to delivered to read-as-delivered and never backwards", async () => {
    const { id, wamid } = await sentMessage();
    expect(wamid).toBe("wamid.1");
    expect((await hook(report(wamid, "delivered"))).status).toBe(200);
    expect((await note(id))?.status).toBe("delivered");
    expect((await hook(report(wamid, "sent"))).status).toBe(200);
    expect((await note(id))?.status).toBe("delivered");
    expect((await hook(report(wamid, "read"))).status).toBe(200);
    expect((await note(id))?.status).toBe("delivered");
    expect((await hook(report(wamid, "failed", [{ code: 131026, message: "late failure" }]))).status).toBe(200);
    expect((await note(id))?.status).toBe("delivered");
  });

  it("records a delivery failure with the provider's reason", async () => {
    const { id, wamid } = await sentMessage();
    expect((await hook(report(wamid, "failed", [{ code: 131026, title: "Undeliverable", message: "Message undeliverable" }]))).status).toBe(200);
    expect(await note(id)).toMatchObject({ status: "failed", error: "Message undeliverable" });
    expect((await f.get("/admin/notifications?status=failed")).body.meta.failedCount).toBe(1);
  });

  it("answers 200 but changes nothing for a call that is not correctly signed", async () => {
    const { id, wamid } = await sentMessage();
    for (const signature of [null, "sha256=" + "0".repeat(64), `sha256=${createHmac("sha256", "wrong-secret").update(JSON.stringify(report(wamid, "delivered"))).digest("hex")}`, "nonsense"]) {
      expect((await hook(report(wamid, "delivered"), signature)).status).toBe(200);
    }
    expect((await note(id))?.status).toBe("sent");
  });

  it("ignores customer replies, unknown messages and odd shapes, and still answers 200", async () => {
    const { id, wamid } = await sentMessage();
    expect((await hook({ entry: [{ changes: [{ value: { messages: [{ from: "919800000001", text: { body: "STOP" } }] } }] }] })).status).toBe(200);
    expect((await hook(report("wamid.unknown", "delivered"))).status).toBe(200);
    expect((await hook({ entry: [{ changes: [{ value: { statuses: [null, 5, { id: 7 }] } }] }] })).status).toBe(200);
    expect((await hook({})).status).toBe(200);
    expect((await note(id))?.status).toBe("sent");
    expect(wamid).toBeTruthy();
  });

  it("can handle several updates in one call", async () => {
    f.msg.person(A, PHONE_A);
    f.msg.person(B, PHONE_B);
    const a = (await confirmed(A, { channels: ["whatsapp"] })).queued[0]!.id;
    const b = (await confirmed(B, { channels: ["whatsapp"] })).queued[0]!.id;
    await f.runJobs();
    const ids = [(await note(a))!.providerMessageId, (await note(b))!.providerMessageId];
    await hook({ entry: [{ changes: [{ value: { statuses: [{ id: ids[0], status: "delivered" }, { id: ids[1], status: "failed", errors: [{ message: "nope" }] }] } }] }] });
    expect((await note(a))?.status).toBe("delivered");
    expect(await note(b)).toMatchObject({ status: "failed", error: "nope" });
  });
});

describe("promo broadcasts", () => {
  const U = ["b1", "b2", "b3", "b4"].map(x => x.repeat(12));
  const body = { zoneIds: [ZONE1], title: "Fresh mountain veggies", body: "Free delivery above ₹399 today", deepLink: "ds://category/cat_1", channels: ["push"] };

  async function audience() {
    f.msg.inZone(ZONE1, U);
    for (const id of U) f.msg.person(id, `+9198000010${U.indexOf(id)}0`, [`tok-${id}`]);
    await f.mods.notifications.delivery.setPrefs(U[1]!, { promoPush: false });
    await f.mods.notifications.delivery.setPrefs(U[3]!, { promoWhatsApp: true });
  }
  it("answers at once with the number of opted-in customers, then sends to exactly those", async () => {
    await audience();
    const res = await f.send("post", "/admin/broadcast", body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.data).toEqual({ jobId: expect.stringMatching(/^[a-f0-9]{24}$/), recipients: 3 });
    expect(f.msg.pushed).toHaveLength(0);
    await f.runJobs();
    expect(f.msg.pushed.map(p => p.token).sort()).toEqual([U[0], U[2], U[3]].map(id => `tok-${id}`).sort());
    expect(f.msg.pushed[0]).toMatchObject({ title: "Fresh mountain veggies", body: "Free delivery above ₹399 today", priority: "normal", data: { type: "promo", deepLink: "ds://category/cat_1" } });
  });

  it("does not send twice when the job is repeated", async () => {
    await audience();
    await f.send("post", "/admin/broadcast", body);
    await f.runJobs();
    const job = await col("jobs").findOne({ type: "notification.broadcast" });
    const again = await f.mods.notifications.campaigns.runBroadcast(job!.payload as never);
    expect(again.queued).toBe(0);
    await f.runJobs();
    expect(f.msg.pushed).toHaveLength(3);
  });

  it("sends WhatsApp broadcasts, with the built-in wording, only to customers who opted in", async () => {
    await audience();
    const res = await f.send("post", "/admin/broadcast", { ...body, channels: ["push", "whatsapp"] });
    expect(res.status).toBe(202);
    expect(res.body.data.recipients).toBe(3);
    await f.runJobs();
    expect(f.msg.pushed).toHaveLength(3);
    expect(f.msg.whatsapped).toEqual([{ to: expect.stringMatching(/^\+91/), templateName: "promo_broadcast", language: "en", params: ["Fresh mountain veggies", "Free delivery above ₹399 today"], buttonParams: [] }]);
  });

  it("only reaches the zones asked for", async () => {
    await audience();
    f.msg.inZone(ZONE2, ["b9".repeat(12)]);
    f.msg.person("b9".repeat(12), null, ["tok-far"]);
    const res = await f.send("post", "/admin/broadcast", { ...body, zoneIds: [ZONE2] });
    expect(res.body.data.recipients).toBe(1);
    await f.runJobs();
    expect(f.msg.pushed.map(p => p.token)).toEqual(["tok-far"]);
  });

  it("checks the request and the caller", async () => {
    const bad = async (over: Record<string, unknown>) => (await f.send("post", "/admin/broadcast", { ...body, ...over })).status;
    expect(await bad({ zoneIds: [] })).toBe(400);
    expect(await bad({ zoneIds: ["z1"] })).toBe(400);
    expect(await bad({ title: "" })).toBe(400);
    expect(await bad({ title: "x".repeat(101) })).toBe(400);
    expect(await bad({ deepLink: "https://example.com" })).toBe(400);
    expect(await bad({ channels: ["sms"] })).toBe(400);
    expect(await bad({ channels: [] })).toBe(400);
    expect(await bad({ extra: 1 })).toBe(400);
    expect(await bad({ deepLink: null })).toBe(202);
    expect((await f.send("post", "/admin/broadcast", body, viewer)).status).toBe(403);
    expect((await f.send("post", "/admin/broadcast", body, {})).status).toBe(401);
  });
});

describe("login codes", () => {
  const otp = () => f.mods.notifications.otp;
  const CODE = "482913";

  it("sends the code by WhatsApp with the copy-code button, and logs the attempt without the code", async () => {
    expect(await otp().send(PHONE_A, CODE)).toEqual({ channel: "whatsapp" });
    expect(f.msg.whatsapped).toEqual([{ to: PHONE_A, templateName: "login_otp", language: "en", params: [CODE], buttonParams: [CODE] }]);
    const rows = await allNotes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, templateKey: "otp_login", channel: "whatsapp", status: "sent", to: "+91*******001", body: null, whatsapp: null });
    expect(JSON.stringify(rows)).not.toContain(CODE);
    expect(JSON.stringify(rows)).not.toContain(PHONE_A);
    expect(f.msg.texted).toEqual([]);
  });

  it("falls back to SMS when WhatsApp fails, and logs both", async () => {
    f.msg.behavior.whatsapp = [new ProviderError("Template not approved", true, "132001")];
    expect(await otp().send(PHONE_A, CODE)).toEqual({ channel: "sms" });
    expect(f.msg.texted).toEqual([{ to: PHONE_A, text: `Your Darjeeling Stores login code is ${CODE}. Valid for 5 minutes.` }]);
    const rows = await allNotes();
    expect(rows.map(r => [r.channel, r.status])).toEqual([["whatsapp", "failed"], ["sms", "sent"]]);
    expect(rows[0]!.error).toBe("Template not approved");
    expect(JSON.stringify(rows)).not.toContain(CODE);
  });

  it("fails with OTP_DELIVERY_FAILED when neither channel works", async () => {
    f.msg.behavior.whatsappAlways = new ProviderError("down", false);
    f.msg.behavior.smsFails = true;
    await expect(otp().send(PHONE_A, CODE)).rejects.toMatchObject({ code: "OTP_DELIVERY_FAILED" });
    const rows = await allNotes();
    expect(rows.map(r => [r.channel, r.status])).toEqual([["whatsapp", "failed"], ["sms", "failed"]]);
  });
});

describe("back in stock alerts, from restock to message", () => {
  async function waitingProduct() {
    const product = await f.pooledProduct("Fresh Tomato (Local)");
    await f.pooledOffer(W1, product, 0);
    return product;
  }
  const subscribe = (productId: string, variantId: string | null, who: string) =>
    f.send("post", "/notify-me", { zoneId: ZONE1, productId, ...(variantId && { variantId }) }, customer(who));
  const restock = (productId: string, grams = 1000) => f.send("post", "/admin/stock/adjust", { warehouseId: W1, productId, variantId: null, delta: grams, reason: "purchase" });

  it("turns a restock into push and WhatsApp messages with the product, size and link", async () => {
    const p = await waitingProduct();
    f.msg.person(A, PHONE_A, ["tok-a"]);
    f.msg.person(B, PHONE_B, []);
    expect((await subscribe(p.id, p.v500, A)).status).toBe(201);
    expect((await subscribe(p.id, null, B)).status).toBe(201);

    expect((await restock(p.id)).status).toBe(200);
    // The hand-over happens straight away: Notify Me has nothing left waiting and four messages are queued.
    expect(await f.mods.availability.notify.pendingMessages()).toEqual([]);
    expect(await col("notifications").countDocuments({ templateKey: "back_in_stock", status: "queued" })).toBe(4);

    await f.runJobs();
    expect(f.msg.pushed).toEqual([{
      token: "tok-a", title: "Back in stock", body: "Fresh Tomato (Local) (500 g) is available again. Order now before it sells out.", priority: "high",
      data: { type: "back_in_stock", productId: p.id, zoneId: ZONE1, deepLink: `ds://product/${p.id}`, notificationId: expect.any(String) },
    }]);
    expect(f.msg.whatsapped.map(m => [m.to, m.templateName, m.params]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      [PHONE_A, "back_in_stock_v1", ["Fresh Tomato (Local)", "500 g"]], [PHONE_B, "back_in_stock_v1", ["Fresh Tomato (Local)", "all sizes"]],
    ]);
    const log = (await f.get(`/admin/notifications?userId=${B}`)).body.data;
    expect(log.find((n: { channel: string }) => n.channel === "push")).toMatchObject({ status: "failed", error: "No registered device for this user" });
    expect(log.find((n: { channel: string }) => n.channel === "whatsapp")).toMatchObject({ status: "sent" });
    expect((await f.get("/notify-me", customer(A))).body.data).toEqual([]);
  });

  it("queues each customer's message once however often the hand-over runs", async () => {
    const p = await waitingProduct();
    f.msg.person(A, PHONE_A, ["tok-a"]);
    await subscribe(p.id, p.v250, A);
    await restock(p.id);
    const again = await Promise.all([1, 2, 3].map(() => f.mods.notifications.campaigns.drainBackInStock()));
    expect(again.every(r => r.handedOver === 0)).toBe(true);
    await f.runJobs();
    expect(await col("notifications").countDocuments({ templateKey: "back_in_stock" })).toBe(2);
    expect(f.msg.pushed).toHaveLength(1);
  });

  it("uses a customer's channel choice from Notify Me", async () => {
    const p = await waitingProduct();
    f.msg.person(A, PHONE_A, ["tok-a"]);
    await f.send("post", "/notify-me", { zoneId: ZONE1, productId: p.id, variantId: p.v500, channels: ["whatsapp"] }, customer(A));
    await restock(p.id);
    await f.runJobs();
    expect(f.msg.pushed).toHaveLength(0);
    expect(f.msg.whatsapped).toHaveLength(1);
  });

  it("includes the product picture in the push when there is one", async () => {
    const p = await waitingProduct();
    f.msg.person(A, PHONE_A, ["tok-a"]);
    const image = await f.send("post", "/media/upload-url", { kind: "product_image", contentType: "image/jpeg", sizeBytes: 90_000, ownerRef: { type: "product", id: p.id } }, { "X-Test-Principal": "admin" });
    f.storage.upload(image.body.data.upload.fields.key);
    await f.send("post", "/media/complete", { mediaId: image.body.data.mediaId }, { "X-Test-Principal": "admin" });
    expect((await f.send("post", `/admin/products/${p.id}/images`, { mediaId: image.body.data.mediaId }, { ...admin, "X-Test-Principal": "admin" })).status).toBe(201);
    await subscribe(p.id, p.v500, A);
    await restock(p.id);
    await f.runJobs();
    expect(f.msg.pushed[0]!.imageUrl).toBe(`https://cdn.fake.test/${image.body.data.upload.fields.key}/320.webp`);
  });
});

describe("background work", () => {
  async function started() {
    const background = await f.mods.startBackground(60_000);
    await background.stop();
    return background;
  }
  const dueNow = () => col("job_schedules").updateMany({}, { $set: { nextRunAt: new Date(0) } });

  it("schedules the sweeps for stock holds, back-in-stock alerts and media", async () => {
    await started();
    const schedules = await col("job_schedules").find({}).toArray();
    expect(schedules.map(s => [s._id, s.intervalMs]).sort()).toEqual([
      ["dispatch.ack_sweep", 10_000], ["dispatch.auto_assign", 15_000], ["media.sweep", 3_600_000], ["notifications.drain_back_in_stock", 60_000], ["payments.expire_overdue", 60_000], ["pricing.expire_rain", 60_000], ["riders.silent_sweep", 60_000], ["stock.release_expired_holds", 60_000],
    ]);
    expect(schedules.every(s => s.nextRunAt > new Date())).toBe(true);
  });

  it("gives back stock held by an order that never finished", async () => {
    await started();
    const product = await f.pooledProduct();
    await f.pooledOffer(W1, product, 5000);
    const reserved = await f.mods.stock.reserve({ key: "order-crashed", holdSeconds: 60, lines: [{ warehouseId: W1, productId: product.id, variantId: product.v500, qty: 2 }] });
    expect(reserved.ok).toBe(true);
    const stock = async () => (await col("warehouse_products").findOne({ warehouseId: W1, productId: product.id }))!.stockGrams;
    expect(await stock()).toBe(4000);
    await f.runJobs();
    expect(await stock()).toBe(4000);

    await col("stock_reservations").updateOne({ key: "order-crashed" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await dueNow();
    await f.runJobs();
    expect(await stock()).toBe(5000);
    expect(await col("stock_reservations").findOne({ key: "order-crashed" })).toMatchObject({ status: "released" });
    await dueNow();
    await f.runJobs();
    expect(await stock()).toBe(5000);
  });

  it("picks up back-in-stock alerts that the immediate hand-over missed", async () => {
    await started();
    const product = await f.pooledProduct();
    await f.pooledOffer(W1, product, 0);
    f.msg.person(A, PHONE_A, ["tok-a"]);
    await f.send("post", "/notify-me", { zoneId: ZONE1, productId: product.id, variantId: product.v500 }, customer(A));
    // The alert was recorded but the hand-over never ran (for example the server stopped right after).
    await f.mods.availability.notify.onZoneAvailabilityChanged({ zoneId: ZONE1, productId: product.id, variantId: product.v500 });
    expect(await f.mods.availability.notify.pendingMessages()).toHaveLength(1);
    await dueNow();
    await f.runJobs();
    expect(await f.mods.availability.notify.pendingMessages()).toEqual([]);
    expect(f.msg.pushed).toHaveLength(1);
  });

  it("deletes media that nobody used", async () => {
    await started();
    const res = await f.send("post", "/media/upload-url", { kind: "address_photo", contentType: "image/jpeg", sizeBytes: 1000 }, { "X-Test-Principal": `customer:${A}` });
    expect(res.status).toBe(201);
    await col("media_files").updateOne({ _id: res.body.data.mediaId }, { $set: { createdAt: new Date(Date.now() - 30 * 3_600_000) } });
    await dueNow();
    await f.runJobs();
    expect(await col("media_files").findOne({ _id: res.body.data.mediaId })).toMatchObject({ status: "deleted", deleteReason: "unattached" });
  });

  it("runs each sweep once per interval and stops when told to", async () => {
    const background = await f.mods.startBackground(20);
    await dueNow();
    for (let i = 0; i < 100 && (await col("jobs").countDocuments({ type: /^recurring:/, status: "done" })) < 8; i++) await new Promise(r => setTimeout(r, 20));
    await background.stop();
    expect(await col("jobs").countDocuments({ type: /^recurring:/, status: "done" })).toBe(8);
    await new Promise(r => setTimeout(r, 100));
    expect(await col("jobs").countDocuments({ type: /^recurring:/ })).toBe(8);
  });
});
