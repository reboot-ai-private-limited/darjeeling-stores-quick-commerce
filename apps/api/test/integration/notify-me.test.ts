import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CUSTOMER_A, CUSTOMER_B, CUSTOMER_C, W1, W2, W3, ZONE1, ZONE2, admin, customer, scoped, startFixture, viewer, type Fixture,
} from "./support/dev2-fixture.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("notify_me_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const A = customer(CUSTOMER_A);
const B = customer(CUSTOMER_B);
const C = customer(CUSTOMER_C);
const col = (name: string) => f.h.connection.collection(name);
const subscribe = (body: Record<string, unknown>, who = A) => f.send("post", "/notify-me", body, who);
const mine = async (who = A) => (await f.get("/notify-me", who)).body;
const restock = (warehouseId: string, productId: string, delta: number) =>
  f.send("post", "/admin/stock/adjust", { warehouseId, productId, variantId: null, delta, reason: delta < 0 ? "wastage" : "purchase" });
/** Every message Notify Me recorded, whether or not it has been handed to delivery yet (a restock hands them over at once). */
const recorded = async () => (await col("back_in_stock_outbox").find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map(({ _id, ...rest }) => ({ subscriptionId: String(_id), ...rest })) as { subscriptionId: string; status: string; attempts: number; message: Record<string, unknown> & { userId: string }; createdAt: Date }[];
const status = (id: string) => col("stock_subscriptions").findOne({ _id: id as never });

describe("subscribing", () => {
  it("saves a waiting subscription for a size or for any size, with both channels unless told otherwise", async () => {
    const p = await f.pooledProduct("Fresh Tomato (Local)");
    await f.pooledOffer(W1, p, 0);

    const sized = await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500, channels: ["push", "whatsapp"] });
    expect(sized.status, JSON.stringify(sized.body)).toBe(201);
    expect(sized.body.data).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/), zoneId: ZONE1, productId: p.id, variantId: p.v500,
      channels: ["push", "whatsapp"], status: "waiting", createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
    });
    const any = await subscribe({ zoneId: ZONE1, productId: p.id }, B);
    expect(any.status).toBe(201);
    expect(any.body.data).toMatchObject({ variantId: null, channels: ["push", "whatsapp"], status: "waiting" });
    expect((await subscribe({ zoneId: ZONE1, productId: p.id, variantId: null, channels: ["whatsapp"] }, C)).body.data.channels).toEqual(["whatsapp"]);
  });

  it("removes duplicate channels and rejects empty or unknown ones", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const base = { zoneId: ZONE1, productId: p.id };
    expect((await subscribe({ ...base, channels: ["push", "push"] })).body.data.channels).toEqual(["push"]);
    expect((await subscribe({ ...base, variantId: p.v250, channels: [] })).status).toBe(400);
    expect((await subscribe({ ...base, variantId: p.v250, channels: ["sms"] })).status).toBe(400);
  });

  it("lists the customer's waiting subscriptions with the product name and size, and nobody else's", async () => {
    const p = await f.pooledProduct("Fresh Tomato (Local)");
    await f.pooledOffer(W1, p, 0);
    const sized = (await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 })).body.data;
    await subscribe({ zoneId: ZONE1, productId: p.id }, B);

    const list = await mine();
    expect(list.meta).toEqual({ count: 1 });
    expect(list.data).toEqual([expect.objectContaining({ id: sized.id, productId: p.id, name: "Fresh Tomato (Local)", variantLabel: "500 g", status: "waiting" })]);
    expect((await mine(B)).data[0]).toMatchObject({ name: "Fresh Tomato (Local)", variantLabel: null });
    expect((await mine(C)).data).toEqual([]);
  });

  it("answers 409 with the existing subscription for a repeat, but keeps a size and any size separate", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const first = (await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 })).body.data;
    const again = await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500, channels: ["push"] });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "CONFLICT", details: { subscription: { id: first.id, status: "waiting" } } });
    expect((await subscribe({ zoneId: ZONE1, productId: p.id })).status).toBe(201);
    expect((await subscribe({ zoneId: ZONE1, productId: p.id })).status).toBe(409);
    expect((await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v250 })).status).toBe(201);
    expect((await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 }, B)).status).toBe(201);
    expect(await col("stock_subscriptions").countDocuments({ status: "waiting" })).toBe(4);
  });

  it("lets only one of several simultaneous identical requests through", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 })));
    expect(results.map(r => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await col("stock_subscriptions").countDocuments({})).toBe(1);
    for (const r of results.filter(x => x.status === 409)) expect(r.body.error.details.subscription.status).toBe("waiting");
  });

  it("refuses an item that is in stock, a size that is not sold, and anything not sold in the zone", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 5000);
    const inStock = await subscribe({ zoneId: ZONE1, productId: tomato.id, variantId: tomato.v500 });
    expect(inStock.status).toBe(400);
    expect(inStock.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { reason: "in_stock" } });
    expect((await subscribe({ zoneId: ZONE1, productId: tomato.id })).status).toBe(400);

    const salt = await f.packagedProduct("Salt");
    await f.packagedOffer(W1, salt, [0, 10]);
    expect((await subscribe({ zoneId: ZONE1, productId: salt.id, variantId: salt.v1 })).status).toBe(201);
    expect((await subscribe({ zoneId: ZONE1, productId: salt.id, variantId: salt.v2 })).status).toBe(400);
    expect((await subscribe({ zoneId: ZONE1, productId: salt.id }, B)).status).toBe(400);

    const other = await f.pooledProduct("Other");
    await f.pooledOffer(W3, other, 0);
    expect((await subscribe({ zoneId: ZONE1, productId: other.id })).status).toBe(404);
    expect((await subscribe({ zoneId: ZONE2, productId: other.id })).status).toBe(201);
    expect((await subscribe({ zoneId: ZONE1, productId: "a".repeat(24) })).status).toBe(404);
    expect((await subscribe({ zoneId: ZONE1, productId: tomato.id, variantId: other.v500 })).status).toBe(404);
  });

  it("refuses an offering that is switched off and a product that is archived", async () => {
    const off = await f.pooledProduct("Off");
    const gone = await f.pooledProduct("Gone");
    const offOffer = await f.pooledOffer(W1, off, 0);
    await f.pooledOffer(W1, gone, 0);
    expect((await f.send("put", `/admin/warehouse-products/${offOffer.id}`, { rev: offOffer.rev, status: "inactive" })).status).toBe(200);
    expect((await subscribe({ zoneId: ZONE1, productId: off.id })).status).toBe(404);
    expect((await f.send("post", `/admin/products/${gone.id}/archive`)).status).toBe(200);
    expect((await subscribe({ zoneId: ZONE1, productId: gone.id })).status).toBe(404);
  });

  it("checks the request shape and who is calling", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const ok = { zoneId: ZONE1, productId: p.id };
    expect((await subscribe({ productId: p.id })).status).toBe(400);
    expect((await subscribe({ zoneId: "zone_1", productId: p.id })).status).toBe(400);
    expect((await subscribe({ ...ok, variantId: "nope" })).status).toBe(400);
    expect((await subscribe({ ...ok, extra: true })).status).toBe(400);
    expect((await f.send("post", "/notify-me", ok, {})).status).toBe(401);
    expect((await f.send("post", "/notify-me", ok, admin)).status).toBe(401);
    expect((await f.get("/notify-me", {})).status).toBe(401);
    expect((await f.send("delete", `/notify-me/${"a".repeat(24)}`, undefined, {})).status).toBe(401);
  });
});

describe("cancelling", () => {
  it("cancels the customer's own subscription, allows subscribing again, and never touches anyone else's", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const body = { zoneId: ZONE1, productId: p.id, variantId: p.v500 };
    const first = (await subscribe(body)).body.data;
    const others = (await subscribe(body, B)).body.data;

    expect((await f.send("delete", `/notify-me/${first.id}`, undefined, B)).status).toBe(404);
    expect((await status(first.id))?.status).toBe("waiting");

    const del = await f.send("delete", `/notify-me/${first.id}`, undefined, A);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ data: { ok: true } });
    expect(await status(first.id)).toMatchObject({ status: "cancelled", cancelledAt: expect.any(Date) });
    expect((await mine()).data).toEqual([]);
    expect((await mine(B)).data).toHaveLength(1);
    expect((await status(others.id))?.status).toBe("waiting");

    expect((await f.send("delete", `/notify-me/${first.id}`, undefined, A)).status).toBe(200);
    expect((await f.send("delete", `/notify-me/${"b".repeat(24)}`, undefined, A)).status).toBe(404);
    expect((await f.send("delete", "/notify-me/not-an-id", undefined, A)).status).toBe(404);
    expect((await subscribe(body)).status).toBe(201);
  });
});

describe("telling customers when an item is back", () => {
  it("notifies each waiting customer of the zone exactly once, for their size or any size, and nobody else", async () => {
    const p = await f.pooledProduct("Fresh Tomato (Local)");
    await f.pooledOffer(W1, p, 0);
    await f.pooledOffer(W3, p, 0);
    const other = await f.pooledProduct("Other");
    await f.pooledOffer(W1, other, 0);
    const a = (await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500, channels: ["push"] }, A)).body.data;
    const b = (await subscribe({ zoneId: ZONE1, productId: p.id }, B)).body.data;
    const c = (await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v250 }, C)).body.data;
    const farAway = (await subscribe({ zoneId: ZONE2, productId: p.id }, A)).body.data;
    const elsewhere = (await subscribe({ zoneId: ZONE1, productId: other.id }, A)).body.data;
    const cancelled = (await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v250 }, A)).body.data;
    await f.send("delete", `/notify-me/${cancelled.id}`, undefined, A);

    expect((await restock(W1, p.id, 1000)).status).toBe(200);

    for (const id of [a.id, b.id, c.id]) expect(await status(id)).toMatchObject({ status: "notified", notifiedAt: expect.any(Date) });
    for (const id of [farAway.id, elsewhere.id]) expect((await status(id))?.status).toBe("waiting");
    expect((await status(cancelled.id))?.status).toBe("cancelled");

    const queued = await recorded();
    expect(queued).toHaveLength(3);
    const byUser = (userId: string) => queued.find(q => q.message.userId === userId)!;
    expect(byUser(CUSTOMER_A)).toMatchObject({ subscriptionId: a.id, status: "delivered" });
    expect(byUser(CUSTOMER_A).message).toEqual({
      subscriptionId: a.id, userId: CUSTOMER_A, zoneId: ZONE1, productId: p.id, variantId: p.v500, productName: "Fresh Tomato (Local)",
      variantLabel: "500 g", imageMediaId: null, channels: ["push"], deepLink: `product/${p.id}`,
    });
    expect(byUser(CUSTOMER_B).message).toMatchObject({ variantId: null, variantLabel: null, channels: ["push", "whatsapp"] });
    expect(byUser(CUSTOMER_C).message).toMatchObject({ variantId: p.v250, variantLabel: "250 g" });

    expect((await mine(B)).data).toEqual([]);
    expect((await mine(A)).data.map((s: { productId: string }) => s.productId).sort()).toEqual([other.id, p.id].sort());
  });

  it("does not message anyone twice when the event arrives again or at the same time", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const users = ["d1", "d2", "d3", "d4"].map(x => x.repeat(12));
    for (const userId of users) expect((await subscribe({ zoneId: ZONE1, productId: p.id }, customer(userId))).status).toBe(201);

    const event = { zoneId: ZONE1, productId: p.id, variantId: p.v500 };
    const results = await Promise.all([1, 2, 3].map(() => f.mods.availability.notify.onZoneAvailabilityChanged(event)));
    expect(results.reduce((sum, r) => sum + r.notified, 0)).toBe(4);
    expect((await f.mods.availability.notify.onZoneAvailabilityChanged(event)).notified).toBe(0);
    expect(await recorded()).toHaveLength(4);
    expect(await col("back_in_stock_outbox").countDocuments({})).toBe(4);
  });

  it("only wakes customers waiting for the size that came back", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 300);
    const waiting = (await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 })).body.data;
    expect((await subscribe({ zoneId: ZONE1, productId: p.id }, B)).status).toBe(400);
    expect((await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v250 }, C)).status).toBe(400);

    expect((await restock(W1, p.id, -300)).status).toBe(200);
    const anySize = (await subscribe({ zoneId: ZONE1, productId: p.id }, B)).body.data;
    // 300 g is one 250 g pack and no 500 g pack, so only the 250 g size is back.
    expect((await restock(W1, p.id, 300)).status).toBe(200);
    expect((await status(waiting.id))?.status).toBe("waiting");
    expect((await status(anySize.id))?.status).toBe("notified");
    // Another 300 g makes a 500 g pack.
    expect((await restock(W1, p.id, 300)).status).toBe(200);
    expect((await status(waiting.id))?.status).toBe("notified");
    expect(await recorded()).toHaveLength(2);
  });

  it("treats the zone as one shop: a restock in either warehouse notifies once, and a second warehouse adds nothing", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    await f.pooledOffer(W2, p, 0);
    const sub = (await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 })).body.data;
    expect((await restock(W2, p.id, 1000)).status).toBe(200);
    expect((await status(sub.id))?.status).toBe("notified");
    expect((await restock(W1, p.id, 1000)).status).toBe(200);
    expect(await recorded()).toHaveLength(1);
    expect((await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 }, B)).status).toBe(400);
  });

  it("notifies again after the item sells out and the customer asks again", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const body = { zoneId: ZONE1, productId: p.id, variantId: p.v500 };
    await subscribe(body);
    await restock(W1, p.id, 1000);
    expect(await recorded()).toHaveLength(1);
    expect((await subscribe(body)).status).toBe(400);
    await restock(W1, p.id, -1000);
    expect((await subscribe(body)).status).toBe(201);
    await restock(W1, p.id, 1000);
    expect(await recorded()).toHaveLength(2);
    expect(await col("stock_subscriptions").countDocuments({ status: "notified" })).toBe(2);
  });

  it("is triggered by a stock-take, a bulk quantity change, an import and a cancelled order giving its stock back", async () => {
    const make = async (name: string) => { const p = await f.pooledProduct(name); const o = await f.pooledOffer(W1, p, 0); return { p, o }; };
    const count = await make("Counted");
    const bulk = await make("Bulked");
    const imported = await make("Imported");
    const given = { p: await f.pooledProduct("Given back"), o: await f.pooledOffer(W1, await f.pooledProduct("Unused"), 0) };
    await f.pooledOffer(W1, given.p, 500);
    const reserved = await f.mods.stock.reserve({ key: "order-1", lines: [{ warehouseId: W1, productId: given.p.id, variantId: given.p.v500, qty: 1 }] });
    expect(reserved.ok).toBe(true);
    const subs: string[] = [];
    for (const { p } of [count, bulk, imported, given]) subs.push((await subscribe({ zoneId: ZONE1, productId: p.id, variantId: p.v500 })).body.data.id);

    expect((await f.send("post", "/admin/stock/count", { warehouseId: W1, counts: [{ productId: count.p.id, variantId: null, counted: 2000 }] })).status).toBe(200);
    expect((await status(subs[0]!))?.status).toBe("notified");

    expect((await f.send("post", "/admin/warehouse-products/bulk", { ids: [bulk.o.id], action: { type: "set_quantity", value: 3000 } })).status).toBe(200);
    expect((await status(subs[1]!))?.status).toBe("notified");

    // A warehouse in another zone has the item in stock; importing it into this zone's second warehouse brings it back here.
    await f.pooledOffer(W3, imported.p, 5000);
    const pre = (await f.send("post", "/admin/import/preview", { sourceWarehouseId: W3, targetWarehouseId: W2, productIds: [imported.p.id] })).body.data;
    expect(pre.rows[0].action).toBe("create");
    expect((await f.send("post", "/admin/import/commit", { previewId: pre.previewId, rows: pre.rows, confirmQuantities: true })).status).toBe(201);
    expect((await status(subs[2]!))?.status).toBe("notified");

    // An order that took the last stock is cancelled and gives it back.
    expect((await f.mods.stock.release("order-1", "cancel")).released).toBe(true);
    expect((await status(subs[3]!))?.status).toBe("notified");
    expect(await recorded()).toHaveLength(4);
  });

  it("works through a large waiting list in pages", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    const now = new Date();
    const docs = Array.from({ length: 410 }, (_, i) => ({
      _id: i.toString(16).padStart(24, "0") as never, userId: (i + 1000).toString(16).padStart(24, "0"), zoneId: ZONE1, productId: p.id,
      variantId: null, channels: ["push", "whatsapp"], status: "waiting", notifiedAt: null, cancelledAt: null, createdAt: now, updatedAt: now,
    }));
    await col("stock_subscriptions").insertMany(docs);
    const res = await f.mods.availability.notify.onZoneAvailabilityChanged({ zoneId: ZONE1, productId: p.id, variantId: p.v500 });
    expect(res.notified).toBe(410);
    expect(await col("stock_subscriptions").countDocuments({ status: "waiting" })).toBe(0);
    expect(await col("back_in_stock_outbox").countDocuments({})).toBe(410);
  }, 120_000);

  it("ignores events for archived products and events that are not about zone availability", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    await subscribe({ zoneId: ZONE1, productId: p.id });
    await f.mods.availability.onStockEvent({ type: "stock.low", zoneId: ZONE1, productId: p.id, variantId: p.v500 });
    await f.mods.availability.onStockEvent({ type: "stock.zone_availability_changed" });
    expect(await recorded()).toHaveLength(0);
    expect((await f.send("post", `/admin/products/${p.id}/archive`)).status).toBe(200);
    expect(await f.mods.availability.notify.onZoneAvailabilityChanged({ zoneId: ZONE1, productId: p.id, variantId: p.v500 })).toEqual({ notified: 0 });
    expect(await col("stock_subscriptions").countDocuments({ status: "waiting" })).toBe(1);
  });

  it("holds messages for the notifications job until it takes them, which it can report delivered or failed", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 0);
    await subscribe({ zoneId: ZONE1, productId: p.id }, A);
    await subscribe({ zoneId: ZONE1, productId: p.id }, B);
    // Record the messages without the automatic hand-over, as if it had not run yet.
    await f.mods.availability.notify.onZoneAvailabilityChanged({ zoneId: ZONE1, productId: p.id, variantId: p.v500 });
    const waiting = () => f.mods.availability.notify.pendingMessages(1000);
    const [first, second] = await waiting();
    expect(first!.createdAt.getTime()).toBeLessThanOrEqual(second!.createdAt.getTime());

    await f.mods.availability.notify.markFailed(first!.subscriptionId, "WhatsApp is down");
    expect((await waiting()).find(e => e.subscriptionId === first!.subscriptionId)).toMatchObject({ status: "pending", attempts: 1, lastError: "WhatsApp is down" });
    await f.mods.availability.notify.markDelivered(first!.subscriptionId);
    expect((await waiting()).map(e => e.subscriptionId)).toEqual([second!.subscriptionId]);
    expect(await col("back_in_stock_outbox").findOne({ _id: first!.subscriptionId as never })).toMatchObject({ status: "delivered", attempts: 2 });
  });
});

describe("the demand list", () => {
  async function seed() {
    const tomato = await f.pooledProduct("Fresh Tomato (Local)");
    const salt = await f.packagedProduct("Salt");
    const far = await f.pooledProduct("Far Away");
    await f.pooledOffer(W1, tomato, 0);
    await f.packagedOffer(W1, salt, [0, 0]);
    await f.pooledOffer(W3, far, 0);
    for (const who of [A, B, C]) await subscribe({ zoneId: ZONE1, productId: tomato.id, variantId: tomato.v500 }, who);
    await subscribe({ zoneId: ZONE1, productId: tomato.id }, A);
    await subscribe({ zoneId: ZONE1, productId: salt.id, variantId: salt.v1 }, A);
    await subscribe({ zoneId: ZONE2, productId: far.id }, A);
    return { tomato, salt, far };
  }

  it("counts who is waiting per product, size and zone, most wanted first", async () => {
    const { tomato, salt, far } = await seed();
    const res = await f.get("/admin/notify-demand");
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ count: 4 });
    expect(res.body.data[0]).toEqual({
      zoneId: ZONE1, productId: tomato.id, name: "Fresh Tomato (Local)", variantId: tomato.v500, variantLabel: "500 g", waiting: 3,
      oldestRequestAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
    });
    expect(res.body.data.slice(1).map((r: { productId: string; variantLabel: string | null; waiting: number }) => [r.productId, r.variantLabel, r.waiting]).sort())
      .toEqual([[far.id, null, 1], [salt.id, "500 g", 1], [tomato.id, null, 1]].sort());
    const oldest = await col("stock_subscriptions").find({ productId: tomato.id, variantId: tomato.v500 }).sort({ createdAt: 1 }).limit(1).toArray();
    expect(res.body.data[0].oldestRequestAt).toBe(oldest[0]!.createdAt.toISOString());
  });

  it("filters by zone or warehouse and leaves out customers who were notified or cancelled", async () => {
    const { tomato } = await seed();
    expect((await f.get(`/admin/notify-demand?zoneId=${ZONE1}`)).body.meta.count).toBe(3);
    expect((await f.get(`/admin/notify-demand?zoneId=${ZONE2}`)).body.meta.count).toBe(1);
    expect((await f.get(`/admin/notify-demand?warehouseId=${W2}`)).body.meta.count).toBe(3);
    expect((await f.get(`/admin/notify-demand?warehouseId=${W3}`)).body.meta.count).toBe(1);
    expect((await f.get(`/admin/notify-demand?zoneId=${ZONE1}&warehouseId=${W3}`)).body.data).toEqual([]);
    expect((await f.get(`/admin/notify-demand?warehouseId=${"d".repeat(24)}`)).status).toBe(404);

    const first = (await mine(A)).data.find((s: { productId: string; variantId: string | null }) => s.productId === tomato.id && s.variantId !== null);
    await f.send("delete", `/notify-me/${first.id}`, undefined, A);
    expect((await f.get(`/admin/notify-demand?zoneId=${ZONE1}`)).body.data[0].waiting).toBe(2);
    await restock(W1, tomato.id, 1000);
    expect((await f.get(`/admin/notify-demand?zoneId=${ZONE1}`)).body.data.map((r: { productId: string }) => r.productId)).not.toContain(tomato.id);
  });

  it("shows scoped staff only the zones of their warehouses, and needs the permission", async () => {
    await seed();
    const own = await f.get("/admin/notify-demand", scoped(W1));
    expect(own.status).toBe(200);
    expect(own.body.data.every((r: { zoneId: string }) => r.zoneId === ZONE1)).toBe(true);
    expect(own.body.meta.count).toBe(3);
    expect((await f.get(`/admin/notify-demand?zoneId=${ZONE1}`, scoped(W2))).body.meta.count).toBe(3);
    expect((await f.get(`/admin/notify-demand?zoneId=${ZONE2}`, scoped(W1))).status).toBe(403);
    expect((await f.get(`/admin/notify-demand?warehouseId=${W3}`, scoped(W1))).status).toBe(403);
    expect((await f.get("/admin/notify-demand", viewer)).status).toBe(403);
    expect((await f.get("/admin/notify-demand", A)).status).toBe(401);
    expect((await f.get("/admin/notify-demand?zoneId=zone_1")).status).toBe(400);
    expect((await f.get("/admin/notify-demand", { "X-Test-Actor": "scoped:" + "9".repeat(24) })).body.data).toEqual([]);
  });
});
