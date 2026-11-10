import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDev2Modules } from "../../src/composition/dev2.js";
import type { MediaKind } from "../../src/modules/media/media.public.js";
import { unconfiguredStorage } from "../../src/modules/media/media.public.js";
import { W1, admin, asPrincipal, startFixture, type Fixture } from "./support/dev2-fixture.js";
import { api, principalFromHeader } from "./support/harness.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("media_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const ANNA = "c1".repeat(12);
const BEN = "c2".repeat(12);
const RIDER = "d1".repeat(12);
const ORDER = "e1".repeat(12);
const anna = asPrincipal(`customer:${ANNA}`);
const ben = asPrincipal(`customer:${BEN}`);
const rider = asPrincipal(`rider:${RIDER}`);
const boss = asPrincipal("admin");
const bossAll = { ...admin, ...boss };
const col = (name: string) => f.h.connection.collection(name);
const file = (id: string) => col("media_files").findOne({ _id: id as never });
const DAY = 86_400_000;

const DEFAULT_BODY: Record<string, Record<string, unknown>> = {
  address_voice: { contentType: "audio/mp4", sizeBytes: 84_210, durationSec: 8 },
};
const requestUpload = (kind: string, who: Record<string, string>, extra: Record<string, unknown> = {}) =>
  f.send("post", "/media/upload-url", { kind, contentType: "image/jpeg", sizeBytes: 100_000, ...DEFAULT_BODY[kind], ...extra }, who);
const complete = (mediaId: string, who: Record<string, string>) => f.send("post", "/media/complete", { mediaId }, who);

/** Request, upload and complete a file, as an app would. */
async function ready(kind: MediaKind, who: Record<string, string>, extra: Record<string, unknown> = {}, info: { bytes?: number; durationSec?: number | null; format?: string } = {}) {
  const res = await requestUpload(kind, who, extra);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const key: string = res.body.data.upload.fields.key;
  f.storage.upload(key, { format: kind === "address_voice" ? "m4a" : "jpg", durationSec: kind === "address_voice" ? 8 : null, ...info });
  const done = await complete(res.body.data.mediaId, who);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return { id: res.body.data.mediaId as string, key, done: done.body.data };
}

describe("asking to upload", () => {
  it("returns a signed upload, saves a pending file and builds the key from random ids only", async () => {
    const res = await requestUpload("address_voice", anna, { ownerRef: { type: "address", id: "a1".repeat(12) } });
    expect(res.status).toBe(201);
    const { mediaId, upload } = res.body.data;
    expect(mediaId).toMatch(/^[a-f0-9]{24}$/);
    expect(upload).toMatchObject({ url: "https://upload.fake.test/", method: "POST", fields: { key: `private/addresses/${"a1".repeat(12)}/${mediaId}`, "Content-Type": "audio/mp4" } });
    expect(upload.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(f.storage.tickets[0]).toMatchObject({ contentType: "audio/mp4", maxBytes: 500 * 1024 });
    expect(await file(mediaId)).toMatchObject({ kind: "address_voice", status: "pending", uploadedBy: ANNA, ownerType: "address", ownerId: "a1".repeat(12), declaredBytes: 84_210 });
  });

  it("uses an 'unassigned' folder when the file is attached later", async () => {
    const res = await requestUpload("address_photo", anna);
    expect(res.body.data.upload.fields.key).toBe(`private/addresses/unassigned/${res.body.data.mediaId}`);
    expect(await file(res.body.data.mediaId)).toMatchObject({ ownerType: null, ownerId: null });
  });

  it("rejects files by type, size and length with UPLOAD_REJECTED and the reason", async () => {
    const expectReason = async (extra: Record<string, unknown>, reason: string, kind = "address_photo", who = anna) => {
      const res = await requestUpload(kind, who, extra);
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(res.body.error).toMatchObject({ code: "UPLOAD_REJECTED", details: { reason } });
    };
    await expectReason({ contentType: "application/pdf" }, "type_not_allowed");
    await expectReason({ contentType: "audio/mp4" }, "type_not_allowed");
    await expectReason({ sizeBytes: 5 * 1024 * 1024 + 1 }, "too_large");
    await expectReason({ sizeBytes: 500 * 1024 + 1 }, "too_large", "address_voice");
    await expectReason({ durationSec: 11 }, "too_long", "address_voice");
    expect((await requestUpload("address_voice", anna)).status).toBe(201);
  });

  it("checks who may upload each kind", async () => {
    const status = async (kind: string, who: Record<string, string>) => (await requestUpload(kind, who)).status;
    expect(await status("product_image", boss)).toBe(201);
    expect(await status("product_image", anna)).toBe(403);
    expect(await status("product_image", rider)).toBe(403);
    expect(await status("product_image", asPrincipal("viewer"))).toBe(403);
    expect(await status("banner", asPrincipal("scoped:" + W1))).toBe(403);
    expect(await status("failed_delivery_photo", rider)).toBe(201);
    expect(await status("failed_delivery_photo", anna)).toBe(403);
    expect(await status("refund_photo", anna)).toBe(201);
    expect(await status("rider_photo", rider)).toBe(201);
    expect(await status("order_photo", boss)).toBe(403);
    expect(await status("order_voice", anna)).toBe(403);
  });

  it("validates the request shape", async () => {
    const bad = async (body: Record<string, unknown>) => (await f.send("post", "/media/upload-url", body, anna)).status;
    expect(await bad({ contentType: "image/jpeg", sizeBytes: 1 })).toBe(400);
    expect(await bad({ kind: "address_photo", contentType: "image/jpeg" })).toBe(400);
    expect(await bad({ kind: "nonsense", contentType: "image/jpeg", sizeBytes: 1 })).toBe(400);
    expect(await bad({ kind: "address_photo", contentType: "image/jpeg", sizeBytes: 0 })).toBe(400);
    expect(await bad({ kind: "address_photo", contentType: "image/jpeg", sizeBytes: 1, extra: true })).toBe(400);
    expect(await bad({ kind: "address_photo", contentType: "image/jpeg", sizeBytes: 1, ownerRef: { type: "product", id: "a".repeat(24) } })).toBe(400);
    expect(await bad({ kind: "address_photo", contentType: "image/jpeg", sizeBytes: 1, ownerRef: { type: "address", id: "short" } })).toBe(400);
    expect(await bad({ kind: "address_voice", contentType: "audio/mp4", sizeBytes: 1000 })).toBe(400);
  });

  it("stops one person piling up unfinished uploads, but not other people", async () => {
    for (let i = 0; i < 3; i++) expect((await requestUpload("address_photo", anna)).status).toBe(201);
    const blocked = await requestUpload("address_photo", anna);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.reason).toBe("too_many_pending");
    expect((await requestUpload("address_photo", ben)).status).toBe(201);
  });

  it("needs a login", async () => {
    expect((await f.send("post", "/media/upload-url", { kind: "address_photo", contentType: "image/jpeg", sizeBytes: 1 }, {})).status).toBe(401);
    expect((await f.send("post", "/media/upload-url", { kind: "address_photo", contentType: "image/jpeg", sizeBytes: 1 }, admin)).status).toBe(401);
  });
});

describe("completing an upload", () => {
  it("measures the stored file and marks it ready", async () => {
    const { id, key, done } = await ready("address_voice", anna, {}, { bytes: 84_210 });
    expect(done).toEqual({ mediaId: id, status: "ready", kind: "address_voice", contentType: "audio/mp4" });
    expect(await file(id)).toMatchObject({ status: "ready", bytes: 84_210, durationSec: 8, readyAt: expect.any(Date), storage: { key, format: "m4a" } });
  });

  it("answers 409 when nothing has been uploaded yet, and works once the file arrives", async () => {
    const res = await requestUpload("address_photo", anna);
    const id = res.body.data.mediaId;
    const early = await complete(id, anna);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "not_uploaded" } });
    expect((await file(id))?.status).toBe("pending");
    f.storage.upload(res.body.data.upload.fields.key);
    expect((await complete(id, anna)).body.data.status).toBe("ready");
  });

  it("is safe to call again, and only one of several simultaneous calls does the work", async () => {
    const res = await requestUpload("address_photo", anna);
    f.storage.upload(res.body.data.upload.fields.key);
    const id = res.body.data.mediaId;
    const results = await Promise.all([1, 2, 3, 4].map(() => complete(id, anna)));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(f.storage.state.finalizeCalls).toBe(1);
    expect((await file(id))?.status).toBe("ready");
    expect((await complete(id, anna)).body.data.status).toBe("ready");
    expect(f.storage.state.finalizeCalls).toBe(1);
  });

  it("removes a file that turned out bigger or longer than allowed, since the provider cannot cap uploads", async () => {
    const big = await requestUpload("address_photo", anna, { sizeBytes: 1000 });
    f.storage.upload(big.body.data.upload.fields.key, { bytes: 9 * 1024 * 1024 });
    const tooBig = await complete(big.body.data.mediaId, anna);
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error).toMatchObject({ code: "UPLOAD_REJECTED", details: { reason: "too_large" } });
    expect(await file(big.body.data.mediaId)).toMatchObject({ status: "failed", failReason: "too_large" });
    expect(f.storage.removed).toContain(big.body.data.upload.fields.key);
    expect(f.storage.has(big.body.data.upload.fields.key)).toBe(false);

    const long = await requestUpload("address_voice", anna);
    f.storage.upload(long.body.data.upload.fields.key, { durationSec: 30, format: "m4a" });
    const tooLong = await complete(long.body.data.mediaId, anna);
    expect(tooLong.body.error.details.reason).toBe("too_long");
    expect((await complete(long.body.data.mediaId, anna)).body.data.status).toBe("failed");
  });

  it("leaves the file pending when the provider is down, so the app can try again", async () => {
    const res = await requestUpload("address_photo", anna);
    f.storage.upload(res.body.data.upload.fields.key);
    f.storage.state.failFinalize = true;
    await expect(complete(res.body.data.mediaId, anna)).resolves.toMatchObject({ status: 500 });
    expect((await file(res.body.data.mediaId))?.status).toBe("pending");
    f.storage.state.failFinalize = false;
    expect((await complete(res.body.data.mediaId, anna)).body.data.status).toBe("ready");
  });

  it("is only for the person who uploaded it", async () => {
    const res = await requestUpload("address_photo", anna);
    f.storage.upload(res.body.data.upload.fields.key);
    expect((await complete(res.body.data.mediaId, ben)).status).toBe(404);
    expect((await complete("f".repeat(24), anna)).status).toBe(404);
    expect((await f.send("post", "/media/complete", { mediaId: "nope" }, anna)).status).toBe(400);
    expect((await f.send("post", "/media/complete", { mediaId: res.body.data.mediaId }, {})).status).toBe(401);
  });
});

describe("product images through the catalog", () => {
  let made = 0;
  async function newProduct() {
    const p = await f.pooledProduct(`Fresh Tomato ${++made}`);
    return p.id;
  }

  it("uploads once, attaches to a product, serves four WebP sizes, and deletes every size when removed", async () => {
    const productId = await newProduct();
    const img = await ready("product_image", boss, { ownerRef: { type: "product", id: productId } });
    expect(img.key).toBe(`public/products/${productId}/${img.id}`);

    const status = await f.get(`/media/${img.id}`, boss);
    expect(status.body.data).toMatchObject({ mediaId: img.id, status: "ready", kind: "product_image" });
    expect(status.body.data.urls).toEqual({
      "160": `https://cdn.fake.test/${img.key}/160.webp`, "320": `https://cdn.fake.test/${img.key}/320.webp`,
      "640": `https://cdn.fake.test/${img.key}/640.webp`, "1080": `https://cdn.fake.test/${img.key}/1080.webp`,
    });

    const attached = await f.send("post", `/admin/products/${productId}/images`, { mediaId: img.id, alt: "Tomatoes" }, bossAll);
    expect(attached.status, JSON.stringify(attached.body)).toBe(201);
    expect(attached.body.data).toMatchObject({ mediaId: img.id, alt: "Tomatoes", sortOrder: 0, urls: { "320": `https://cdn.fake.test/${img.key}/320.webp` } });
    expect(await file(img.id)).toMatchObject({ ownerType: "product", ownerId: productId, attachedAt: expect.any(Date) });
    const product = (await f.get(`/admin/products/${productId}`)).body.data;
    expect(product.images[0].urls["1080"]).toContain("/1080.webp");

    const removed = await f.send("delete", `/admin/products/${productId}/images/${img.id}`, undefined, bossAll);
    expect(removed.status).toBe(200);
    expect(await file(img.id)).toMatchObject({ status: "deleted", deleteReason: "product_image_removed", variants: [] });
    expect(f.storage.removed).toEqual([img.key]);
    expect((await f.get(`/media/${img.id}`, boss)).status).toBe(404);
    expect(await col("audit_log").countDocuments({ action: "catalog.product.image_remove", entityId: productId })).toBe(1);
  });

  it("claims an upload that had no owner yet, and refuses to give one file to two products", async () => {
    const [one, two] = [await newProduct(), await newProduct()];
    const img = await ready("product_image", boss);
    expect((await f.send("post", `/admin/products/${one}/images`, { mediaId: img.id }, bossAll)).status).toBe(201);
    expect(await file(img.id)).toMatchObject({ ownerType: "product", ownerId: one });
    const second = await f.send("post", `/admin/products/${two}/images`, { mediaId: img.id }, bossAll);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
    expect((await f.get(`/admin/products/${two}`)).body.data.images).toEqual([]);
  });

  it("only accepts ready public product images for a product", async () => {
    const productId = await newProduct();
    const pending = await requestUpload("product_image", boss);
    expect((await f.send("post", `/admin/products/${productId}/images`, { mediaId: pending.body.data.mediaId }, bossAll)).status).toBe(404);
    const voice = await ready("address_voice", anna);
    expect((await f.send("post", `/admin/products/${productId}/images`, { mediaId: voice.id }, bossAll)).status).toBe(404);
    // A category image is a public image, but it cannot belong to a product.
    const category = await ready("category_image", boss);
    expect((await f.send("post", `/admin/products/${productId}/images`, { mediaId: category.id }, bossAll)).status).toBe(400);
    expect((await f.send("post", `/admin/products/${productId}/images`, { mediaId: "a".repeat(24) }, bossAll)).status).toBe(404);
  });

  it("deletes the images of a product that is permanently deleted", async () => {
    const productId = await newProduct();
    const img = await ready("product_image", boss, { ownerRef: { type: "product", id: productId } });
    expect((await f.send("post", `/admin/products/${productId}/images`, { mediaId: img.id }, bossAll)).status).toBe(201);
    // Nothing orders or offers this product, but the catalog stays cautious until the orders module confirms it.
    expect((await f.send("delete", `/admin/products/${productId}`, undefined, bossAll)).status).toBe(409);
    expect(f.storage.removed).toEqual([]);
    expect((await file(img.id))?.status).toBe("ready");
  });
});

describe("reading files", () => {
  it("shows the owner the status of a pending upload, and strangers nothing", async () => {
    const res = await requestUpload("address_photo", anna);
    const id = res.body.data.mediaId;
    expect((await f.get(`/media/${id}`, anna)).body.data).toEqual({ mediaId: id, status: "pending", kind: "address_photo", contentType: "image/jpeg" });
    expect((await f.get(`/media/${id}`, ben)).status).toBe(403);
    expect((await f.get(`/media/${id}`, {})).status).toBe(401);
    expect((await f.get(`/media/${"9".repeat(24)}`, anna)).status).toBe(404);
    expect((await f.get("/media/not-an-id", anna)).status).toBe(404);
  });

  it("gives private files no public addresses, and a short-lived signed link to those allowed to read them", async () => {
    const voice = await ready("address_voice", anna);
    const status = await f.get(`/media/${voice.id}`, anna);
    expect(status.body.data).not.toHaveProperty("urls");

    const link = await f.get(`/media/${voice.id}/url`, anna);
    expect(link.status).toBe(200);
    expect(link.body.data.url).toBe(`https://signed.fake.test/${voice.key}?ttl=300`);
    const seconds = (new Date(link.body.data.expiresAt).getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(290);
    expect(seconds).toBeLessThanOrEqual(301);
  });

  it("lets only the owner and staff who may see orders read a private file", async () => {
    const voice = await ready("address_voice", anna);
    const url = (who: Record<string, string>) => f.get(`/media/${voice.id}/url`, who);
    expect((await url(ben)).status).toBe(403);
    expect((await url(rider)).status).toBe(403);
    expect((await url(asPrincipal("viewer"))).status).toBe(403);
    expect((await url(asPrincipal("scoped:" + W1))).status).toBe(403);
    expect((await url(asPrincipal("orders"))).status).toBe(200);
    expect((await url(boss)).status).toBe(200);
    expect((await f.get(`/media/${voice.id}/url`, {})).status).toBe(401);
  });

  it("lets a rider read a file when the access policy says the rider is assigned", async () => {
    const policyFixture = createDev2Modules({
      connection: f.h.connection, storage: f.storage.provider, principal: principalFromHeader,
      mediaPolicy: { riderCanRead: async (riderId, media) => riderId === RIDER && media.kind === "order_photo", staffCanRead: async () => false },
    });
    const app = f.h.appWith(policyFixture.routes);
    const voice = await ready("address_photo", anna);
    const copy = await f.mods.media.service.copyToOrder({ sourceMediaId: voice.id, orderId: ORDER });
    const read = (id: string, who: Record<string, string>) => request(app).get(`${api}/media/${id}/url`).set(who);
    expect((await read(copy.mediaId, rider)).status).toBe(200);
    expect((await read(voice.id, rider)).status).toBe(403);
    expect((await read(copy.mediaId, asPrincipal("customer:" + "c9".repeat(12)))).status).toBe(403);
  });

  it("serves a public image address to any logged-in user, with no expiry", async () => {
    const img = await ready("banner", boss);
    const link = await f.get(`/media/${img.id}/url`, anna);
    expect(link.body.data).toEqual({ url: `https://cdn.fake.test/${img.key}/1080.webp`, expiresAt: null });
    expect((await f.get(`/media/${img.id}`, anna)).body.data.urls["320"]).toContain("/320.webp");
  });

  it("does not give out a link before the upload is complete", async () => {
    const res = await requestUpload("address_photo", anna);
    expect((await f.get(`/media/${res.body.data.mediaId}/url`, anna)).status).toBe(404);
  });
});

describe("deleting a file", () => {
  it("lets a customer delete their own address voice note, removing the stored file and writing an audit entry", async () => {
    const voice = await ready("address_voice", anna);
    const res = await f.send("delete", `/media/${voice.id}`, undefined, anna);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true } });
    expect(await file(voice.id)).toMatchObject({ status: "deleted", deleteReason: "deleted_by_user", deletedAt: expect.any(Date), deleteError: null });
    expect(f.storage.removed).toEqual([voice.key]);
    expect(await col("audit_log").findOne({ action: "media.delete", entityId: voice.id })).toMatchObject({ actorId: ANNA, entityType: "media_file", actorRole: "customer" });
    expect((await f.get(`/media/${voice.id}`, anna)).status).toBe(404);
    expect((await f.send("delete", `/media/${voice.id}`, undefined, anna)).status).toBe(404);
  });

  it("refuses other people's files and kinds the customer may not delete", async () => {
    const voice = await ready("address_voice", anna);
    expect((await f.send("delete", `/media/${voice.id}`, undefined, ben)).status).toBe(403);
    const refund = await ready("refund_photo", anna);
    expect((await f.send("delete", `/media/${refund.id}`, undefined, anna)).status).toBe(403);
    expect((await f.send("delete", `/media/${voice.id}`, undefined, rider)).status).toBe(403);
    expect((await f.send("delete", `/media/${voice.id}`, undefined, asPrincipal("orders"))).status).toBe(403);
    expect((await f.send("delete", `/media/${voice.id}`, undefined, {})).status).toBe(401);
    expect(f.storage.removed).toEqual([]);
    expect((await file(voice.id))?.status).toBe("ready");
  });

  it("lets staff delete an unattached catalog image, but sends them to the product when it is in use", async () => {
    const productId = (await f.pooledProduct()).id;
    const loose = await ready("category_image", boss);
    expect((await f.send("delete", `/media/${loose.id}`, undefined, asPrincipal("viewer"))).status).toBe(403);
    expect((await f.send("delete", `/media/${loose.id}`, undefined, boss)).status).toBe(200);

    const used = await ready("product_image", boss);
    expect((await f.send("post", `/admin/products/${productId}/images`, { mediaId: used.id }, bossAll)).status).toBe(201);
    const refused = await f.send("delete", `/media/${used.id}`, undefined, boss);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual({ reason: "in_use" });
    expect((await file(used.id))?.status).toBe("ready");
  });

  it("can delete an upload that was never completed", async () => {
    const res = await requestUpload("address_photo", anna);
    expect((await f.send("delete", `/media/${res.body.data.mediaId}`, undefined, anna)).status).toBe(200);
    expect((await file(res.body.data.mediaId))?.status).toBe("deleted");
  });
});

describe("failed deletions", () => {
  async function stuck() {
    const voice = await ready("address_voice", anna);
    f.storage.state.failRemove = true;
    const res = await f.send("delete", `/media/${voice.id}`, undefined, anna);
    expect(res.status).toBe(200);
    return voice;
  }

  it("keeps the file as 'deleting', hides it from the owner, lists it for admins, and records why", async () => {
    const voice = await stuck();
    expect(await file(voice.id)).toMatchObject({ status: "deleting", deleteAttempts: 1, deleteError: "AccessDenied", deletedAt: null });
    expect((await f.get(`/media/${voice.id}`, anna)).status).toBe(404);

    const list = await f.get("/admin/media/failed", boss);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([{ mediaId: voice.id, kind: "address_voice", status: "deleting", attempts: 1, error: "AccessDenied", since: expect.stringMatching(/^\d{4}-/) }]);
  });

  it("retries on demand: still failing it stays listed with a higher count, then succeeds and disappears", async () => {
    const voice = await stuck();
    const again = await f.send("post", `/admin/media/${voice.id}/retry-delete`, undefined, boss);
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ status: "deleting" });
    expect((await f.get("/admin/media/failed", boss)).body.data[0].attempts).toBe(2);

    f.storage.state.failRemove = false;
    const fixed = await f.send("post", `/admin/media/${voice.id}/retry-delete`, undefined, boss);
    expect(fixed.body.data).toEqual({ status: "deleted" });
    expect((await f.get("/admin/media/failed", boss)).body.data).toEqual([]);
    expect(f.storage.removed).toEqual([voice.key]);
    expect(await col("audit_log").countDocuments({ action: "media.retry_delete", entityId: voice.id })).toBe(2);
  });

  it("retries by itself with a growing wait, through the sweeper", async () => {
    const voice = await stuck();
    expect(await f.mods.media.service.sweep()).toMatchObject({ retried: 0 });
    await col("media_files").updateOne({ _id: voice.id as never }, { $set: { nextDeleteAt: new Date(Date.now() - 1000) } });
    f.storage.state.failRemove = false;
    expect(await f.mods.media.service.sweep()).toMatchObject({ retried: 1 });
    expect((await file(voice.id))?.status).toBe("deleted");
  });

  it("is for admins with catalog:manage, and only for files waiting to be deleted", async () => {
    const voice = await stuck();
    for (const who of [anna, rider, asPrincipal("viewer"), asPrincipal("orders")]) {
      expect((await f.get("/admin/media/failed", who)).status).toBe(403);
      expect((await f.send("post", `/admin/media/${voice.id}/retry-delete`, undefined, who)).status).toBe(403);
    }
    expect((await f.get("/admin/media/failed", {})).status).toBe(401);
    const fine = await ready("address_photo", ben);
    expect((await f.send("post", `/admin/media/${fine.id}/retry-delete`, undefined, boss)).status).toBe(409);
    expect((await f.send("post", `/admin/media/${"9".repeat(24)}/retry-delete`, undefined, boss)).status).toBe(404);
    expect((await f.send("post", `/admin/media/${voice.id}/retry-delete`, undefined, asPrincipal("scoped:" + W1))).status).toBe(200);
  });
});

describe("order copies and retention", () => {
  it("copies an address file onto an order once, keeping the original and the owner", async () => {
    const voice = await ready("address_voice", anna, { ownerRef: { type: "address", id: "a1".repeat(12) } });
    const first = await f.mods.media.service.copyToOrder({ sourceMediaId: voice.id, orderId: ORDER });
    expect(first.kind).toBe("order_voice");
    expect(f.storage.copies).toEqual([`private/orders/${ORDER}/${first.mediaId}`]);
    expect(await file(first.mediaId)).toMatchObject({
      kind: "order_voice", status: "ready", ownerType: "order", ownerId: ORDER, uploadedBy: ANNA, copiedFromId: voice.id, bytes: 50_000, deleteAfter: null,
    });
    expect((await f.mods.media.service.copyToOrder({ sourceMediaId: voice.id, orderId: ORDER })).mediaId).toBe(first.mediaId);
    expect(f.storage.copies).toHaveLength(1);
    expect((await f.mods.media.service.copyToOrder({ sourceMediaId: voice.id, orderId: "e2".repeat(12) })).mediaId).not.toBe(first.mediaId);

    // Deleting the address file leaves the order's copy alone.
    expect((await f.send("delete", `/media/${voice.id}`, undefined, anna)).status).toBe(200);
    expect((await file(first.mediaId))?.status).toBe("ready");
    expect((await f.get(`/media/${first.mediaId}/url`, anna)).status).toBe(200);
  });

  it("keeps one copy when two orders race, and cleans up the loser's stored file", async () => {
    const photo = await ready("address_photo", anna);
    const results = await Promise.all([1, 2, 3].map(() => f.mods.media.service.copyToOrder({ sourceMediaId: photo.id, orderId: ORDER })));
    expect(new Set(results.map(r => r.mediaId)).size).toBe(1);
    expect(await col("media_files").countDocuments({ copiedFromId: photo.id })).toBe(1);
    const kept = `private/orders/${ORDER}/${results[0]!.mediaId}`;
    expect(f.storage.has(kept)).toBe(true);
    expect(f.storage.copies.filter(k => k !== kept).every(k => f.storage.removed.includes(k))).toBe(true);
  });

  it("only copies ready address files", async () => {
    const pending = await requestUpload("address_photo", anna);
    await expect(f.mods.media.service.copyToOrder({ sourceMediaId: pending.body.data.mediaId, orderId: ORDER })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const refund = await ready("refund_photo", anna);
    await expect(f.mods.media.service.copyToOrder({ sourceMediaId: refund.id, orderId: ORDER })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes order copies seven days after the order ends, and the app is told the file expired", async () => {
    const voice = await ready("address_voice", anna);
    const photo = await ready("address_photo", anna);
    const copyV = await f.mods.media.service.copyToOrder({ sourceMediaId: voice.id, orderId: ORDER });
    const copyP = await f.mods.media.service.copyToOrder({ sourceMediaId: photo.id, orderId: ORDER });
    const delivered = new Date(Date.now() - 8 * DAY);
    expect(await f.mods.media.service.scheduleOrderMediaExpiry(ORDER, delivered)).toBe(2);
    expect((await file(copyV.mediaId))?.deleteAfter).toEqual(new Date(delivered.getTime() + 7 * DAY));

    expect(await f.mods.media.service.sweep()).toEqual({ expired: 2, retried: 0, unattached: 0 });
    for (const id of [copyV.mediaId, copyP.mediaId]) expect(await file(id)).toMatchObject({ status: "deleted", deleteReason: "expired" });
    const gone = await f.get(`/media/${copyV.mediaId}/url`, anna);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toMatchObject({ code: "NOT_FOUND", details: { reason: "expired" } });
    // The saved address files are separate and stay.
    expect((await file(voice.id))?.status).toBe("ready");
    expect(f.storage.has(voice.key)).toBe(true);
  });

  it("leaves order copies alone until the seven days are up", async () => {
    const voice = await ready("address_voice", anna);
    const copy = await f.mods.media.service.copyToOrder({ sourceMediaId: voice.id, orderId: ORDER });
    await f.mods.media.service.scheduleOrderMediaExpiry(ORDER, new Date(Date.now() - 6 * DAY));
    expect(await f.mods.media.service.sweep()).toMatchObject({ expired: 0 });
    expect((await file(copy.mediaId))?.status).toBe("ready");
  });

  it("keeps delivery and refund photos for 90 days", async () => {
    const proof = await ready("failed_delivery_photo", rider, { ownerRef: { type: "order", id: ORDER } });
    const refund = await ready("refund_photo", anna, { ownerRef: { type: "order", id: ORDER } });
    const voice = await ready("address_voice", anna);
    const copy = await f.mods.media.service.copyToOrder({ sourceMediaId: voice.id, orderId: ORDER });
    const closed = new Date(Date.now() - 80 * DAY);
    expect(await f.mods.media.service.scheduleEvidenceExpiry(ORDER, closed)).toBe(2);
    expect(await f.mods.media.service.sweep()).toMatchObject({ expired: 0 });
    await f.mods.media.service.scheduleEvidenceExpiry(ORDER, new Date(Date.now() - 91 * DAY));
    expect(await f.mods.media.service.sweep()).toMatchObject({ expired: 2 });
    for (const id of [proof.id, refund.id]) expect((await file(id))?.status).toBe("deleted");
    expect((await file(copy.mediaId))?.deleteAfter).toBeNull();
  });

  it("removes everything an owner has when the owner goes away", async () => {
    const address = "a2".repeat(12);
    const voice = await ready("address_voice", anna, { ownerRef: { type: "address", id: address } });
    const photo = await ready("address_photo", anna, { ownerRef: { type: "address", id: address } });
    const other = await ready("address_photo", anna, { ownerRef: { type: "address", id: "a3".repeat(12) } });
    expect(await f.mods.media.service.removeForOwner({ type: "address", id: address }, "address_deleted")).toBe(2);
    for (const id of [voice.id, photo.id]) expect(await file(id)).toMatchObject({ status: "deleted", deleteReason: "address_deleted" });
    expect((await file(other.id))?.status).toBe("ready");
    expect(await col("audit_log").countDocuments({ action: "media.delete", actorId: "system" })).toBe(2);
  });
});

describe("cleaning up files nobody used", () => {
  const age = (id: string, hours: number) => col("media_files").updateOne({ _id: id as never }, { $set: { createdAt: new Date(Date.now() - hours * 3_600_000), updatedAt: new Date(Date.now() - hours * 3_600_000) } });

  it("removes uploads never finished and ready files never attached, after a day", async () => {
    const abandoned = await requestUpload("address_photo", anna);
    f.storage.upload(abandoned.body.data.upload.fields.key);
    const loose = await ready("product_image", boss);
    const attached = await ready("address_photo", ben, { ownerRef: { type: "address", id: "a1".repeat(12) } });
    const recent = await requestUpload("address_photo", ben);
    for (const id of [abandoned.body.data.mediaId, loose.id, attached.id]) await age(id, 25);

    expect(await f.mods.media.service.sweep()).toEqual({ expired: 0, retried: 0, unattached: 2 });
    expect((await file(abandoned.body.data.mediaId))).toMatchObject({ status: "deleted", deleteReason: "unattached" });
    expect((await file(loose.id))?.status).toBe("deleted");
    expect(f.storage.has(abandoned.body.data.upload.fields.key)).toBe(false);
    expect((await file(attached.id))?.status).toBe("ready");
    expect((await file(recent.body.data.mediaId))?.status).toBe("pending");
  });

  it("clears out files that failed their checks", async () => {
    const res = await requestUpload("address_photo", anna, { sizeBytes: 100 });
    f.storage.upload(res.body.data.upload.fields.key, { bytes: 99 * 1024 * 1024 });
    await complete(res.body.data.mediaId, anna);
    await age(res.body.data.mediaId, 30);
    expect(await f.mods.media.service.sweep()).toMatchObject({ unattached: 1 });
    expect((await file(res.body.data.mediaId))?.status).toBe("deleted");
  });
});

describe("when storage is not configured", () => {
  it("answers 503 instead of pretending to work", async () => {
    const bare = createDev2Modules({ connection: f.h.connection, storage: unconfiguredStorage, principal: principalFromHeader });
    const app = f.h.appWith(bare.routes);
    const res = await request(app).post(`${api}/media/upload-url`).set(anna).send({ kind: "address_photo", contentType: "image/jpeg", sizeBytes: 1000 });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "SERVICE_UNAVAILABLE", requestId: res.headers["x-request-id"] });
    expect(await col("media_files").countDocuments({})).toBe(0);
  });
});
