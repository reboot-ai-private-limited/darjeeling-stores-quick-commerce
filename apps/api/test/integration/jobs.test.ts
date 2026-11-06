import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJobService } from "../../src/modules/jobs/application/job-service.js";
import { PermanentJobError, retryDelayMs } from "../../src/modules/jobs/domain/job.js";
import { createMongoJobStore } from "../../src/modules/jobs/infrastructure/mongo-job-store.js";
import { startHarness, type Harness } from "./support/harness.js";

let h: Harness;
let store: ReturnType<typeof createMongoJobStore>;
let clock = new Date("2026-11-05T10:00:00Z");
const tick = (ms: number) => { clock = new Date(clock.getTime() + ms); };
/** A worker with its own name that shares the database and the test clock. */
const worker = (workerId: string, leaseMs = 60_000) => createJobService({ store, now: () => clock, newId: () => new Types.ObjectId().toHexString(), workerId, leaseMs });
const jobs = () => h.connection.collection("jobs");
const job = (id: string) => jobs().findOne({ _id: id as never });

beforeAll(async () => { h = await startHarness("jobs_integration_test"); store = createMongoJobStore(h.connection); }, 180_000);
afterAll(async () => { await h?.stop(); });
beforeEach(async () => { await h.reset(); await store.ensureIndexes(); clock = new Date("2026-11-05T10:00:00Z"); });

describe("enqueuing", () => {
  it("saves a pending job that runs when it is due, not before", async () => {
    const w = worker("w1");
    const ran: unknown[] = [];
    w.register("greet", async ({ payload }) => { ran.push(payload); });
    const { id } = await w.queue.enqueue({ type: "greet", payload: { name: "Asha" }, runAt: new Date(clock.getTime() + 60_000) });
    expect(await job(id)).toMatchObject({ status: "pending", attempts: 0, type: "greet", payload: { name: "Asha" } });
    expect(await w.runOnce()).toBe(0);
    tick(60_000);
    expect(await w.runOnce()).toBe(1);
    expect(ran).toEqual([{ name: "Asha" }]);
    expect(await job(id)).toMatchObject({ status: "done", attempts: 1, completedAt: clock, lockedUntil: null });
  });

  it("treats a repeated dedupe key as the same job", async () => {
    const w = worker("w1");
    const first = await w.queue.enqueue({ type: "x", dedupeKey: "order-1-confirmation" });
    const second = await w.queue.enqueue({ type: "x", dedupeKey: "order-1-confirmation" });
    expect(second).toEqual({ id: first.id, duplicate: true });
    expect(first.duplicate).toBe(false);
    expect(await jobs().countDocuments({})).toBe(1);
    const parallel = await Promise.all([1, 2, 3, 4].map(() => w.queue.enqueue({ type: "x", dedupeKey: "same" })));
    expect(new Set(parallel.map(p => p.id)).size).toBe(1);
    expect(await jobs().countDocuments({})).toBe(2);
  });

  it("runs due jobs oldest first", async () => {
    const w = worker("w1");
    const order: string[] = [];
    w.register("t", async ({ payload }) => { order.push(String(payload.n)); });
    await w.queue.enqueue({ type: "t", payload: { n: 3 }, runAt: new Date(clock.getTime() - 1000) });
    await w.queue.enqueue({ type: "t", payload: { n: 1 }, runAt: new Date(clock.getTime() - 3000) });
    await w.queue.enqueue({ type: "t", payload: { n: 2 }, runAt: new Date(clock.getTime() - 2000) });
    await w.runOnce();
    expect(order).toEqual(["1", "2", "3"]);
  });

  it("leaves jobs of a kind nobody handles for whoever does", async () => {
    const a = worker("a");
    const b = worker("b");
    a.register("only-a", async () => undefined);
    await b.queue.enqueue({ type: "only-b" });
    expect(await a.runOnce()).toBe(0);
    expect(await jobs().countDocuments({ status: "pending" })).toBe(1);
    const seen: string[] = [];
    b.register("only-b", async () => { seen.push("b"); });
    expect(await b.runOnce()).toBe(1);
    expect(seen).toEqual(["b"]);
  });

  it("cancels a job that has not started, by id or by dedupe key, but not one that already ran", async () => {
    const w = worker("w1");
    w.register("t", async () => undefined);
    const a = await w.queue.enqueue({ type: "t", runAt: new Date(clock.getTime() + 1000) });
    const b = await w.queue.enqueue({ type: "t", dedupeKey: "key-b", runAt: new Date(clock.getTime() + 1000) });
    expect(await w.queue.cancel(a.id)).toBe(true);
    expect(await w.queue.cancel("key-b")).toBe(true);
    expect(await w.queue.cancel(a.id)).toBe(false);
    expect(await job(a.id)).toMatchObject({ status: "cancelled" });
    tick(5000);
    expect(await w.runOnce()).toBe(0);
    const c = await w.queue.enqueue({ type: "t" });
    await w.runOnce();
    expect(await w.queue.cancel(c.id)).toBe(false);
    expect(await w.queue.cancel("no-such-job")).toBe(false);
    expect(b.id).toBeTruthy();
  });
});

describe("failures and retries", () => {
  it("retries with a growing wait, then marks the job failed and tells its owner once", async () => {
    const w = worker("w1");
    const exhausted: { id: string; message: string }[] = [];
    w.register("flaky", async () => { throw new Error("provider down"); }, { maxAttempts: 3, onExhausted: (j, e) => { exhausted.push({ id: j.id, message: e.message }); } });
    const { id } = await w.queue.enqueue({ type: "flaky" });

    expect(await w.runOnce()).toBe(1);
    expect(await job(id)).toMatchObject({ status: "pending", attempts: 1, lastError: "provider down", runAt: new Date(clock.getTime() + retryDelayMs(1)) });
    expect(await w.runOnce()).toBe(0);
    tick(retryDelayMs(1));
    await w.runOnce();
    expect(await job(id)).toMatchObject({ status: "pending", attempts: 2, runAt: new Date(clock.getTime() + retryDelayMs(2)) });
    tick(retryDelayMs(2));
    await w.runOnce();
    expect(await job(id)).toMatchObject({ status: "failed", attempts: 3, lastError: "provider down", completedAt: clock });
    expect(exhausted).toEqual([{ id, message: "provider down" }]);
    tick(10 * 3_600_000);
    expect(await w.runOnce()).toBe(0);
    expect(exhausted).toHaveLength(1);
  });

  it("recovers on a later try and stops retrying", async () => {
    const w = worker("w1");
    let calls = 0;
    w.register("recovers", async () => { if (++calls < 3) throw new Error("not yet"); return { ok: true }; });
    const { id } = await w.queue.enqueue({ type: "recovers" });
    for (let i = 0; i < 3; i++) { await w.runOnce(); tick(retryDelayMs(i + 1)); }
    expect(calls).toBe(3);
    expect(await job(id)).toMatchObject({ status: "done", attempts: 3, lastError: null, result: { ok: true } });
  });

  it("stops at once for an error that can never succeed", async () => {
    const w = worker("w1");
    const exhausted: string[] = [];
    w.register("doomed", async () => { throw new PermanentJobError("no recipient"); }, { onExhausted: (_j, e) => { exhausted.push(e.message); } });
    const { id } = await w.queue.enqueue({ type: "doomed" });
    await w.runOnce();
    expect(await job(id)).toMatchObject({ status: "failed", attempts: 1, lastError: "no recipient" });
    expect(exhausted).toEqual(["no recipient"]);
  });

  it("keeps working when the owner's failure callback throws", async () => {
    const w = worker("w1");
    w.register("x", async () => { throw new PermanentJobError("nope"); }, { onExhausted: () => { throw new Error("callback broke"); } });
    const { id } = await w.queue.enqueue({ type: "x" });
    await expect(w.runOnce()).resolves.toBe(1);
    expect((await job(id))?.status).toBe("failed");
  });

  it("backs off 30 seconds, doubling, up to an hour", () => {
    expect([1, 2, 3, 4, 8, 20].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
  });
});

describe("workers that share the queue", () => {
  it("never run the same job at once, however many workers there are", async () => {
    const workers = [worker("a"), worker("b"), worker("c")];
    const ran: string[] = [];
    for (const w of workers) w.register("t", async ({ payload }) => { ran.push(String(payload.n)); await new Promise(r => setTimeout(r, 5)); });
    for (let n = 0; n < 12; n++) await workers[0]!.queue.enqueue({ type: "t", payload: { n } });
    await Promise.all(workers.map(w => w.runOnce()));
    expect(ran.sort()).toEqual(Array.from({ length: 12 }, (_, n) => String(n)).sort());
    expect(await jobs().countDocuments({ status: "done", attempts: 1 })).toBe(12);
  });

  it("lets another worker take over a job whose worker died, after its hold runs out", async () => {
    const dead = worker("dead", 60_000);
    const alive = worker("alive", 60_000);
    const ran: string[] = [];
    alive.register("t", async () => { ran.push("alive"); });
    const { id } = await dead.queue.enqueue({ type: "t" });
    // The first worker takes the job and then "crashes": it never finishes or reports.
    const taken = await store.claimNext(clock, 60_000, "dead", ["t"]);
    expect(taken?.id).toBe(id);
    expect(await alive.runOnce()).toBe(0);
    tick(59_000);
    expect(await alive.runOnce()).toBe(0);
    tick(2_000);
    expect(await alive.runOnce()).toBe(1);
    expect(ran).toEqual(["alive"]);
    expect(await job(id)).toMatchObject({ status: "done", attempts: 2, lockedBy: null });
  });

  it("ignores a late result from a worker that already lost the job", async () => {
    const w = worker("w2");
    w.register("t", async () => undefined);
    const { id } = await w.queue.enqueue({ type: "t" });
    await store.claimNext(clock, 1000, "slow", ["t"]);
    tick(2000);
    await w.runOnce();
    expect(await store.complete(id, "slow", "late", clock)).toBe(false);
    expect(await store.fail(id, "slow", "late", null, clock)).toBe(false);
    expect(await job(id)).toMatchObject({ status: "done", result: null });
  });

  it("stops a job whose workers keep dying, instead of running it for ever", async () => {
    const w = worker("w1", 1000);
    const ran: number[] = [];
    const exhausted: string[] = [];
    w.register("crashy", async ({ attempt }) => { ran.push(attempt); }, { maxAttempts: 2, onExhausted: (_j, e) => { exhausted.push(e.message); } });
    const { id } = await w.queue.enqueue({ type: "crashy" });
    for (let i = 0; i < 3; i++) { await store.claimNext(clock, 1000, "crasher", ["crashy"]); tick(2000); }
    await w.runOnce();
    expect(ran).toEqual([]);
    expect(await job(id)).toMatchObject({ status: "failed", attempts: 4 });
    expect(exhausted).toHaveLength(1);
  });
});

describe("recurring work", () => {
  it("runs every interval and, across servers, only once per interval", async () => {
    const a = worker("a");
    const b = worker("b");
    let runs = 0;
    for (const w of [a, b]) await w.every("sweep", 60_000, async () => { runs++; });
    expect(await Promise.all([a.runOnce(), b.runOnce()])).toEqual([0, 0]);
    tick(60_000);
    await Promise.all([a.runOnce(), b.runOnce()]);
    expect(runs).toBe(1);
    tick(30_000);
    await Promise.all([a.runOnce(), b.runOnce()]);
    expect(runs).toBe(1);
    tick(30_000);
    await Promise.all([a.runOnce(), b.runOnce()]);
    expect(runs).toBe(2);
    expect(await jobs().countDocuments({ type: "recurring:sweep" })).toBe(2);
  });

  it("does not pile up missed runs after downtime: one run, then back on schedule", async () => {
    const w = worker("w1");
    let runs = 0;
    await w.every("sweep", 60_000, async () => { runs++; });
    tick(10 * 60_000);
    await w.runOnce();
    await w.runOnce();
    expect(runs).toBe(1);
    tick(60_000);
    await w.runOnce();
    expect(runs).toBe(2);
  });

  it("carries on with the next interval when a run fails", async () => {
    const w = worker("w1");
    let runs = 0;
    await w.every("flaky", 60_000, async () => { runs++; throw new Error("boom"); });
    tick(60_000); await w.runOnce();
    tick(60_000); await w.runOnce();
    expect(runs).toBe(2);
    expect(await jobs().countDocuments({ type: "recurring:flaky", status: "failed" })).toBe(2);
  });
});

describe("running in the background", () => {
  it("polls for work after start and finishes the job in progress on stop", async () => {
    const w = createJobService({ store, now: () => new Date(), newId: () => new Types.ObjectId().toHexString(), workerId: "bg" });
    const done: number[] = [];
    w.register("t", async ({ payload }) => { await new Promise(r => setTimeout(r, 20)); done.push(Number(payload.n)); });
    w.start(10);
    w.start(10);
    await w.queue.enqueue({ type: "t", payload: { n: 1 } });
    await w.queue.enqueue({ type: "t", payload: { n: 2 } });
    for (let i = 0; i < 100 && done.length < 2; i++) await new Promise(r => setTimeout(r, 20));
    await w.stop();
    expect(done.sort()).toEqual([1, 2]);
    await w.queue.enqueue({ type: "t", payload: { n: 3 } });
    await new Promise(r => setTimeout(r, 80));
    expect(done).toHaveLength(2);
    expect(await w.stats()).toMatchObject({ done: 2, pending: 1 });
  });
});
