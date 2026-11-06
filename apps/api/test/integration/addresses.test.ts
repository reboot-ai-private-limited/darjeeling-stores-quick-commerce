import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, CUSTOMER_B, ZONE1, ZONE2, admin, asPrincipal, customer, startFixture, type Fixture } from "./support/dev2-fixture.js";
import { CITY1, LOC1, LOC2, LOC_OFF } from "./support/fake-geography.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("addresses_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const A = CUSTOMER_A;
const B = CUSTOMER_B;
const col = (name: string) => f.h.connection.collection(name);
const media = (id: string) => col("media_files").findOne({ _id: id as never });
const savedAddresses = (userId: string) => col("addresses").find({ userId }).toArray();
const IN_ZONE1 = { lat: 27.041, lng: 88.2663 };
const IN_ZONE2 = { lat: 27.25, lng: 88.25 };
const OUTSIDE = { lat: 28.5, lng: 88.25 };
const base = {
  label: "Home", line1: "Cedar Villa, 2nd floor", localityId: LOC1, pincode: "734101", landmark: "Opposite Planters Club gate", contactName: "Asha Rai",
  contactPhone: "98765 43210", location: IN_ZONE1, locationAccuracyM: 18, deliveryNotes: "Ring the bell twice",
};
const add = (body: Record<string, unknown> = {}, who = A) => f.send("post", "/addresses", { ...base, ...body }, customer(who));
const edit = (id: string, body: Record<string, unknown>, who = A) => f.send("put", `/addresses/${id}`, body, customer(who));
const show = (id: string, who = A) => f.get(`/addresses/${id}`, customer(who));
const list = async (who = A) => (await f.get("/addresses", customer(who))).body;

async function upload(kind: "address_voice" | "address_photo" | "product_image", userId = A) {
  const body = kind === "address_voice" ? { kind, contentType: "audio/mp4", sizeBytes: 84_210, durationSec: 8 } : { kind, contentType: "image/jpeg", sizeBytes: 50_000 };
  const who = kind === "product_image" ? asPrincipal("admin") : asPrincipal(`customer:${userId}`);
  const res = await f.send("post", "/media/upload-url", body, who);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const key: string = res.body.data.upload.fields.key;
  f.storage.upload(key, { format: kind === "address_voice" ? "m4a" : "jpg", durationSec: kind === "address_voice" ? 8 : null });
  const done = await f.send("post", "/media/complete", { mediaId: res.body.data.mediaId }, who);
  expect(done.status).toBe(200);
  return { id: res.body.data.mediaId as string, key, pending: false };
}

describe("saving an address", () => {
  it("resolves the zone, city and area name on the server, and makes the first address the default", async () => {
    const res = await add();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/), label: "Home", line1: "Cedar Villa, 2nd floor", cityId: CITY1, localityId: LOC1, localityName: "Chowrasta", pincode: "734101",
      landmark: "Opposite Planters Club gate", contactName: "Asha Rai", contactPhone: "+919876543210", location: IN_ZONE1, locationAccuracyM: 18,
      zoneId: ZONE1, isDeliverable: true, isDefault: true, voiceNote: null, housePhoto: null, deliveryNotes: "Ring the bell twice",
    });
    const [stored] = await savedAddresses(A);
    expect(stored).toMatchObject({ userId: A, location: { type: "Point", coordinates: [88.2663, 27.041] } });
  });

  it("makes a later address the default only when asked, and keeps exactly one default", async () => {
    const first = (await add()).body.data;
    const second = (await add({ label: "Work", line1: "Office" })).body.data;
    expect([first.isDefault, second.isDefault]).toEqual([true, false]);
    const third = (await add({ label: "Other", line1: "Aunt", makeDefault: true })).body.data;
    expect(third.isDefault).toBe(true);
    const all = (await list()).data;
    expect(all.map((a: { id: string }) => a.id)).toEqual([third.id, second.id, first.id]);
    expect(all.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
  });

  it("saves an address outside every zone as not deliverable instead of refusing it", async () => {
    const res = await add({ location: OUTSIDE });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ zoneId: null, isDeliverable: false, localityName: "Chowrasta" });
  });

  it("keeps a paused zone's address but marks it not deliverable", async () => {
    f.geo.pauseZone(ZONE1);
    expect((await add()).body.data).toMatchObject({ zoneId: ZONE1, isDeliverable: false });
    f.geo.disableZone(ZONE2);
    expect((await add({ location: IN_ZONE2, localityId: LOC2 })).body.data).toMatchObject({ zoneId: null, isDeliverable: false });
  });

  it("needs a landmark and a locality, and checks every other field", async () => {
    const status = async (over: Record<string, unknown>) => (await add(over)).status;
    const without = async (field: string) => { const body: Record<string, unknown> = { ...base }; delete body[field]; return (await f.send("post", "/addresses", body, customer(A))).status; };
    expect(await without("landmark")).toBe(400);
    expect(await without("localityId")).toBe(400);
    expect(await without("line1")).toBe(400);
    expect(await without("pincode")).toBe(400);
    expect(await without("contactName")).toBe(400);
    expect(await without("contactPhone")).toBe(400);
    expect(await without("location")).toBe(400);
    expect(await status({ landmark: " " })).toBe(400);
    expect(await status({ landmark: "x" })).toBe(400);
    expect(await status({ pincode: "73410" })).toBe(400);
    expect(await status({ pincode: "034101" })).toBe(400);
    expect(await status({ contactPhone: "12345" })).toBe(400);
    expect(await status({ location: { lat: 91, lng: 88 } })).toBe(400);
    expect(await status({ location: { lat: 27, lng: 88, extra: 1 } })).toBe(400);
    expect(await status({ label: "Office" })).toBe(400);
    expect(await status({ localityId: "short" })).toBe(400);
    expect(await status({ deliveryNotes: "x".repeat(301) })).toBe(400);
    expect(await status({ locationAccuracyM: -1 })).toBe(400);
    expect(await status({ voiceMediaId: "nope" })).toBe(400);
    expect(await status({ somethingElse: true })).toBe(400);
    expect((await list()).data).toEqual([]);
  });

  it("answers 404 for a locality that is unknown or switched off", async () => {
    expect((await add({ localityId: "9".repeat(24) })).status).toBe(404);
    expect((await add({ localityId: LOC_OFF })).status).toBe(404);
  });

  it("stores the contact as a normalised number and defaults the label to Home", async () => {
    const body: Record<string, unknown> = { ...base, contactPhone: "+91 98765-43210" };
    delete body.label;
    const res = await f.send("post", "/addresses", body, customer(A));
    expect(res.body.data).toMatchObject({ label: "Home", contactPhone: "+919876543210" });
  });

  it("allows at most twenty addresses", async () => {
    for (let i = 0; i < 20; i++) expect((await add({ line1: `House ${i}` })).status).toBe(201);
    const res = await add({ line1: "One too many" });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ reason: "too_many" });
    expect((await list(B)).data).toEqual([]);
    expect((await add({}, B)).status).toBe(201);
  }, 60_000);

  it("keeps exactly one default even when several are made the default at the same moment", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(i => add({ line1: `House ${i}`, makeDefault: true })));
    expect(results.map(r => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await col("addresses").countDocuments({ userId: A, isDefault: true })).toBe(1);
    expect(await col("addresses").countDocuments({ userId: A })).toBe(5);
  });
});

describe("voice notes and house photos", () => {
  it("attaches the customer's own uploads, reports the voice note's length, and stores them against the address", async () => {
    const voice = await upload("address_voice");
    const photo = await upload("address_photo");
    const res = await add({ voiceMediaId: voice.id, housePhotoMediaId: photo.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ voiceNote: { mediaId: voice.id, durationSec: 8 }, housePhoto: { mediaId: photo.id } });
    const id = res.body.data.id;
    expect(await media(voice.id)).toMatchObject({ ownerType: "address", ownerId: id, status: "ready" });
    expect(await media(photo.id)).toMatchObject({ ownerType: "address", ownerId: id });
    expect((await show(id)).body.data.voiceNote).toEqual({ mediaId: voice.id, durationSec: 8 });
    // The owner can fetch a short-lived link to the private file.
    expect((await f.get(`/media/${voice.id}/url`, asPrincipal(`customer:${A}`))).status).toBe(200);
  });

  it("refuses files that are not the customer's own, not finished, or the wrong kind, and saves nothing", async () => {
    const theirs = await upload("address_voice", B);
    const wrongKind = await upload("address_photo");
    const product = await upload("product_image");
    const pending = await f.send("post", "/media/upload-url", { kind: "address_voice", contentType: "audio/mp4", sizeBytes: 1000, durationSec: 3 }, asPrincipal(`customer:${A}`));
    for (const body of [
      { voiceMediaId: theirs.id }, { voiceMediaId: wrongKind.id }, { voiceMediaId: product.id }, { voiceMediaId: pending.body.data.mediaId },
      { voiceMediaId: "9".repeat(24) }, { housePhotoMediaId: theirs.id }, { housePhotoMediaId: product.id },
    ]) {
      const res = await add(body);
      expect(res.status, JSON.stringify(body)).toBe(404);
    }
    expect((await list()).data).toEqual([]);
    expect(await media(theirs.id)).toMatchObject({ ownerId: null });
  });

  it("will not give one file to two addresses, and frees the other file when a save fails", async () => {
    const shared = await upload("address_voice");
    const first = await add({ voiceMediaId: shared.id });
    expect(first.status).toBe(201);
    const fresh = await upload("address_photo");
    const clash = await add({ voiceMediaId: shared.id, housePhotoMediaId: fresh.id });
    expect(clash.status).toBe(409);
    expect((await list()).data).toHaveLength(1);
    expect(await media(shared.id)).toMatchObject({ ownerId: first.body.data.id });

    // The photo had been claimed before the voice note failed; it is free to use again.
    const other = await upload("address_voice");
    const photo = await upload("address_photo");
    const used = await add({ line1: "Second", voiceMediaId: other.id });
    const clash2 = await add({ line1: "Third", housePhotoMediaId: photo.id, voiceMediaId: other.id });
    expect(clash2.status).toBe(409);
    expect(await media(photo.id)).toMatchObject({ ownerId: null, status: "ready" });
    expect((await add({ line1: "Third", housePhotoMediaId: photo.id })).status).toBe(201);
    expect(used.status).toBe(201);
  });
});

describe("reading addresses", () => {
  it("lists a customer's addresses with a count, and shows one", async () => {
    const a = (await add()).body.data;
    await add({ label: "Work" });
    const res = await f.get("/addresses", customer(A));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ count: 2 });
    expect(res.body.data[0]).toEqual(a);
    expect((await show(a.id)).body.data).toEqual(a);
    expect((await list(B)).meta).toEqual({ count: 0 });
  });

  it("treats another customer's address as not found everywhere", async () => {
    const a = (await add()).body.data;
    expect((await show(a.id, B)).status).toBe(404);
    expect((await edit(a.id, { line1: "Mine now" }, B)).status).toBe(404);
    expect((await f.send("delete", `/addresses/${a.id}`, undefined, customer(B))).status).toBe(404);
    expect((await f.send("post", `/addresses/${a.id}/default`, undefined, customer(B))).status).toBe(404);
    expect((await show("9".repeat(24))).status).toBe(404);
    expect((await show("not-an-id")).status).toBe(404);
    expect((await show(a.id)).body.data.line1).toBe("Cedar Villa, 2nd floor");
  });

  it("needs a logged-in customer for all six calls", async () => {
    const a = (await add()).body.data;
    const calls: [("get" | "post" | "put" | "delete"), string][] = [["get", "/addresses"], ["post", "/addresses"], ["get", `/addresses/${a.id}`], ["put", `/addresses/${a.id}`], ["delete", `/addresses/${a.id}`], ["post", `/addresses/${a.id}/default`]];
    for (const [method, path] of calls) {
      for (const who of [{}, admin]) {
        const res = method === "get" ? await f.get(path, who) : await f.send(method, path, {}, who);
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    }
  });
});

describe("editing an address", () => {
  it("changes only what was sent", async () => {
    const a = (await add()).body.data;
    const res = await edit(a.id, { landmark: "Behind the old post office", contactName: "Tashi" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ...a, landmark: "Behind the old post office", contactName: "Tashi" });
    expect((await edit(a.id, {})).body.data).toEqual(res.body.data);
  });

  it("works out the zone again when the place moves, and the city and area name when the locality changes", async () => {
    const a = (await add()).body.data;
    const moved = (await edit(a.id, { location: IN_ZONE2 })).body.data;
    expect(moved).toMatchObject({ zoneId: ZONE2, isDeliverable: true, localityName: "Chowrasta" });
    const relocated = (await edit(a.id, { localityId: LOC2 })).body.data;
    expect(relocated).toMatchObject({ localityId: LOC2, localityName: "Ghoom", zoneId: ZONE2 });
    const out = (await edit(a.id, { location: OUTSIDE })).body.data;
    expect(out).toMatchObject({ zoneId: null, isDeliverable: false });
    expect((await edit(a.id, { localityId: "9".repeat(24) })).status).toBe(404);
    expect((await show(a.id)).body.data.zoneId).toBeNull();
  });

  it("keeps the landmark required and checks every field as on create", async () => {
    const a = (await add()).body.data;
    for (const body of [{ landmark: "" }, { landmark: "x" }, { pincode: "1" }, { contactPhone: "1" }, { label: "Office" }, { location: { lat: 200, lng: 0 } }, { unknown: 1 }, { line1: "" }]) {
      expect((await edit(a.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await show(a.id)).body.data).toEqual(a);
  });

  it("replaces a voice note or photo and deletes the old file", async () => {
    const v1 = await upload("address_voice");
    const p1 = await upload("address_photo");
    const a = (await add({ voiceMediaId: v1.id, housePhotoMediaId: p1.id })).body.data;
    const v2 = await upload("address_voice");
    const p2 = await upload("address_photo");
    const res = await edit(a.id, { voiceMediaId: v2.id, housePhotoMediaId: p2.id });
    expect(res.body.data).toMatchObject({ voiceNote: { mediaId: v2.id, durationSec: 8 }, housePhoto: { mediaId: p2.id } });
    expect(await media(v1.id)).toMatchObject({ status: "deleted", deleteReason: "address_media_replaced" });
    expect(await media(p1.id)).toMatchObject({ status: "deleted" });
    expect(f.storage.removed.sort()).toEqual([v1.key, p1.key].sort());
    expect(await media(v2.id)).toMatchObject({ ownerType: "address", ownerId: a.id, status: "ready" });
  });

  it("removes a voice note or photo when sent null, and leaves it alone when left out or sent again", async () => {
    const v = await upload("address_voice");
    const p = await upload("address_photo");
    const a = (await add({ voiceMediaId: v.id, housePhotoMediaId: p.id })).body.data;
    expect((await edit(a.id, { landmark: "Another landmark", voiceMediaId: v.id })).body.data).toMatchObject({ voiceNote: { mediaId: v.id } });
    expect(f.storage.removed).toEqual([]);
    const cleared = (await edit(a.id, { voiceMediaId: null })).body.data;
    expect(cleared).toMatchObject({ voiceNote: null, housePhoto: { mediaId: p.id } });
    expect(await media(v.id)).toMatchObject({ status: "deleted" });
    expect((await edit(a.id, { housePhotoMediaId: null })).body.data.housePhoto).toBeNull();
    expect(f.storage.removed.sort()).toEqual([v.key, p.key].sort());
  });

  it("keeps the old file when the new one is refused", async () => {
    const v = await upload("address_voice");
    const a = (await add({ voiceMediaId: v.id })).body.data;
    const theirs = await upload("address_voice", B);
    expect((await edit(a.id, { voiceMediaId: theirs.id })).status).toBe(404);
    expect((await show(a.id)).body.data.voiceNote).toEqual({ mediaId: v.id, durationSec: 8 });
    expect(await media(v.id)).toMatchObject({ status: "ready" });
    expect(f.storage.removed).toEqual([]);
  });

  it("can make an address the default while editing it", async () => {
    const first = (await add()).body.data;
    const second = (await add({ label: "Work" })).body.data;
    expect((await edit(second.id, { makeDefault: true })).body.data.isDefault).toBe(true);
    expect((await show(first.id)).body.data.isDefault).toBe(false);
    expect((await edit(second.id, { makeDefault: false })).body.data.isDefault).toBe(true);
    expect((await edit(first.id, { line1: "New line" })).body.data.isDefault).toBe(false);
  });
});

describe("making an address the default", () => {
  it("switches the default and clears the old one", async () => {
    const a = (await add()).body.data;
    const b = (await add({ label: "Work" })).body.data;
    const res = await f.send("post", `/addresses/${b.id}/default`, undefined, customer(A));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ...b, isDefault: true });
    expect((await show(a.id)).body.data.isDefault).toBe(false);
    expect((await f.send("post", `/addresses/${b.id}/default`, undefined, customer(A))).body.data.isDefault).toBe(true);
    expect(await col("addresses").countDocuments({ userId: A, isDefault: true })).toBe(1);
  });

  it("does not touch another customer's default", async () => {
    await add({}, B);
    const mine = (await add()).body.data;
    await f.send("post", `/addresses/${mine.id}/default`, undefined, customer(A));
    expect((await list(B)).data[0].isDefault).toBe(true);
  });
});

describe("deleting an address", () => {
  it("deletes it with its voice note and photo", async () => {
    const v = await upload("address_voice");
    const p = await upload("address_photo");
    const a = (await add({ voiceMediaId: v.id, housePhotoMediaId: p.id })).body.data;
    const res = await f.send("delete", `/addresses/${a.id}`, undefined, customer(A));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true } });
    expect((await show(a.id)).status).toBe(404);
    expect(await media(v.id)).toMatchObject({ status: "deleted", deleteReason: "address_deleted" });
    expect(await media(p.id)).toMatchObject({ status: "deleted" });
    expect(f.storage.removed.sort()).toEqual([v.key, p.key].sort());
    expect((await f.send("delete", `/addresses/${a.id}`, undefined, customer(A))).status).toBe(404);
  });

  it("hands the default to the newest remaining address when the default is deleted, and leaves it when another is deleted", async () => {
    const a = (await add()).body.data;
    const b = (await add({ label: "Work" })).body.data;
    const c = (await add({ label: "Other" })).body.data;
    await f.send("delete", `/addresses/${b.id}`, undefined, customer(A));
    expect((await list()).data.map((x: { id: string; isDefault: boolean }) => [x.id, x.isDefault])).toEqual([[a.id, true], [c.id, false]]);
    await f.send("delete", `/addresses/${a.id}`, undefined, customer(A));
    expect((await list()).data.map((x: { id: string; isDefault: boolean }) => [x.id, x.isDefault])).toEqual([[c.id, true]]);
    await f.send("delete", `/addresses/${c.id}`, undefined, customer(A));
    expect((await list()).data).toEqual([]);
    expect((await add()).body.data.isDefault).toBe(true);
  });

  it("leaves a file shared with an order copy alone: the order keeps its own", async () => {
    const v = await upload("address_voice");
    const a = (await add({ voiceMediaId: v.id })).body.data;
    const copy = await f.mods.media.service.copyToOrder({ sourceMediaId: v.id, orderId: "e1".repeat(12) });
    await f.send("delete", `/addresses/${a.id}`, undefined, customer(A));
    expect(await media(v.id)).toMatchObject({ status: "deleted" });
    expect(await media(copy.mediaId)).toMatchObject({ status: "ready", ownerType: "order" });
  });
});

describe("for the cart and orders", () => {
  it("gives the orders module a customer's address with its zone, and nothing for someone else's", async () => {
    const a = (await add()).body.data;
    const reader = f.mods.addresses.reader;
    expect(await reader.forOrder(A, a.id)).toEqual(a);
    expect(await reader.forOrder(B, a.id)).toBeNull();
    expect(await reader.forOrder(A, "9".repeat(24))).toBeNull();
  });

  it("sees a changed zone straight away, so the cart can ask the customer to confirm", async () => {
    const a = (await add()).body.data;
    await edit(a.id, { location: IN_ZONE2 });
    expect((await f.mods.addresses.reader.forOrder(A, a.id))?.zoneId).toBe(ZONE2);
  });

  it("removes every address and file of a closed account", async () => {
    const v = await upload("address_voice");
    const a1 = (await add({ voiceMediaId: v.id })).body.data;
    await add({ line1: "Second" });
    await add({ line1: "Other person's" }, B);
    expect(await f.mods.addresses.reader.removeAllFor(A)).toBe(2);
    expect((await list()).data).toEqual([]);
    expect(await media(v.id)).toMatchObject({ status: "deleted", deleteReason: "account_deleted" });
    expect((await list(B)).data).toHaveLength(1);
    expect(a1.id).toBeTruthy();
  });
});
