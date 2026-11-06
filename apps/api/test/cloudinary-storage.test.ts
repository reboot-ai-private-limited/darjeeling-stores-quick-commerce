import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cloudinaryConfigFromEnv, cloudinarySign, createCloudinaryStorage } from "../src/modules/media/infrastructure/cloudinary-storage.js";
import type { StoredRef } from "../src/modules/media/domain/media.js";

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const NOW = new Date("2026-11-05T10:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const config = { cloudName: "demo", apiKey: "key123", apiSecret: "s3cret" };
const productRef: StoredRef = { provider: "cloudinary", key: "public/products/p1/m1", resource: "image", access: "public", format: "jpg" };
const voiceRef: StoredRef = { provider: "cloudinary", key: "private/addresses/a1/m2", resource: "audio", access: "private", format: "m4a" };

interface Call { url: string; init: RequestInit }
function fakeFetch(...answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const answer = answers.shift() ?? new Response("{}", { status: 200 });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { calls, impl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const storage = (fetchImpl: typeof fetch, extra = {}) => createCloudinaryStorage({ ...config, fetch: fetchImpl, now: () => NOW, ...extra });
const formOf = (call: Call) => Object.fromEntries(new URLSearchParams(String(call.init.body)));

describe("signing requests", () => {
  it("hashes the parameters sorted by name, joined with &, followed by the secret", () => {
    const params = { timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" };
    expect(cloudinarySign(params, "abcd")).toBe(sha1("eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510abcd"));
    // The worked example in Cloudinary's own signing guide.
    expect(cloudinarySign(params, "abcd")).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("leaves out empty values and does not depend on the order the parameters were written", () => {
    expect(cloudinarySign({ b: "2", a: "1", c: undefined, d: null, e: "" }, "z")).toBe(sha1("a=1&b=2z"));
    expect(cloudinarySign({ a: "1", b: "2" }, "z")).toBe(cloudinarySign({ b: "2", a: "1" }, "z"));
  });
});

describe("reading the settings from the environment", () => {
  it("accepts the standard CLOUDINARY_URL", () => {
    expect(cloudinaryConfigFromEnv({ CLOUDINARY_URL: "cloudinary://key123:s3cret@demo" })).toEqual({ apiKey: "key123", apiSecret: "s3cret", cloudName: "demo" });
  });
  it("accepts three separate variables and an optional delivery address", () => {
    expect(cloudinaryConfigFromEnv({ CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s", CLOUDINARY_DELIVERY_URL: "https://img.example.com" }))
      .toEqual({ cloudName: "demo", apiKey: "k", apiSecret: "s", deliveryBaseUrl: "https://img.example.com" });
  });
  it("is unconfigured when anything is missing or malformed", () => {
    expect(cloudinaryConfigFromEnv({})).toBeUndefined();
    expect(cloudinaryConfigFromEnv({ CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k" })).toBeUndefined();
    expect(cloudinaryConfigFromEnv({ CLOUDINARY_URL: "https://not-cloudinary" })).toBeUndefined();
  });
});

describe("uploading", () => {
  it("returns a signed browser upload for a public image, without ever including the secret", async () => {
    const { ref, ticket } = await storage(fakeFetch().impl).createUpload({
      key: productRef.key, resource: "image", access: "public", contentType: "image/jpeg", maxBytes: 5_000_000, expiresAt: new Date(NOW.getTime() + 900_000),
    });
    expect(ref).toEqual({ provider: "cloudinary", key: productRef.key, resource: "image", access: "public", format: null });
    expect(ticket.url).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(ticket.method).toBe("POST");
    expect(ticket.fields).toMatchObject({ public_id: productRef.key, type: "upload", allowed_formats: "jpg,png,webp,heic", overwrite: "false", timestamp: String(NOW_S), api_key: "key123" });
    const { api_key, signature, ...signed } = ticket.fields;
    expect(api_key).toBe("key123");
    expect(signature).toBe(cloudinarySign(signed, "s3cret"));
    expect(JSON.stringify(ticket)).not.toContain("s3cret");
  });

  it("uploads voice notes as the video type, privately", async () => {
    const { ticket } = await storage(fakeFetch().impl).createUpload({ key: voiceRef.key, resource: "audio", access: "private", contentType: "audio/mp4", maxBytes: 500_000, expiresAt: NOW });
    expect(ticket.url).toBe("https://api.cloudinary.com/v1_1/demo/video/upload");
    expect(ticket.fields).toMatchObject({ type: "authenticated", allowed_formats: "m4a,aac,mp4" });
  });
});

describe("public image addresses", () => {
  it("builds a resized WebP address for each width", () => {
    const s = storage(fakeFetch().impl);
    expect(s.publicUrl(productRef, 320)).toBe("https://res.cloudinary.com/demo/image/upload/c_limit,w_320,f_webp,q_auto/public/products/p1/m1.webp");
    expect(s.publicUrl(productRef, 1080)).toContain("w_1080,");
  });
  it("can be served from your own domain", () => {
    expect(storage(fakeFetch().impl, { deliveryBaseUrl: "https://img.example.com/" }).publicUrl(productRef, 160))
      .toBe("https://img.example.com/demo/image/upload/c_limit,w_160,f_webp,q_auto/public/products/p1/m1.webp");
  });
});

describe("links to private files", () => {
  it("signs a download that expires after the given time", async () => {
    const { url, expiresAt } = await storage(fakeFetch().impl).signedReadUrl(voiceRef, 300);
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://api.cloudinary.com/v1_1/demo/video/download");
    const query = Object.fromEntries(parsed.searchParams);
    expect(query).toMatchObject({ public_id: voiceRef.key, format: "m4a", type: "authenticated", timestamp: String(NOW_S), expires_at: String(NOW_S + 300), api_key: "key123" });
    const { api_key, signature, ...signed } = query;
    expect(api_key).toBe("key123");
    expect(signature).toBe(cloudinarySign(signed, "s3cret"));
    expect(expiresAt).toEqual(new Date((NOW_S + 300) * 1000));
    expect(url).not.toContain("s3cret");
  });
});

describe("checking an uploaded file", () => {
  it("reads size, format and length from the Admin API with the account credentials", async () => {
    const { calls, impl } = fakeFetch(json({ bytes: 84210, format: "m4a", duration: 8.2 }));
    const found = await storage(impl).finalize(voiceRef, { widths: [160, 320] });
    expect(found).toEqual({ exists: true, bytes: 84210, format: "m4a", durationSec: 8.2, variants: [] });
    expect(calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/demo/resources/video/authenticated/private/addresses/a1/m2");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("key123:s3cret").toString("base64")}`);
  });

  it("lists the sizes of a public image", async () => {
    const found = await storage(fakeFetch(json({ bytes: 120000, format: "jpg" })).impl).finalize(productRef, { widths: [160, 320] });
    expect(found.variants).toEqual([{ width: 160, key: productRef.key, bytes: null }, { width: 320, key: productRef.key, bytes: null }]);
    expect(found.durationSec).toBeNull();
  });

  it("says a missing file does not exist, and reports provider trouble as 503", async () => {
    expect((await storage(fakeFetch(json({ error: { message: "Resource not found" } }, 404)).impl).finalize(productRef, { widths: [] })).exists).toBe(false);
    await expect(storage(fakeFetch(json({}, 500)).impl).finalize(productRef, { widths: [] })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(storage(fakeFetch(new Error("network down")).impl).finalize(productRef, { widths: [] })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("copying a file", () => {
  it("uploads the source through a short-lived signed address to the new key", async () => {
    const { calls, impl } = fakeFetch(json({ bytes: 84210, format: "m4a", duration: 8.2 }));
    const copied = await storage(impl).copy(voiceRef, "private/orders/o1/m9");
    expect(copied).toEqual({ ref: { provider: "cloudinary", key: "private/orders/o1/m9", resource: "audio", access: "private", format: "m4a" }, bytes: 84210, durationSec: 8.2 });
    expect(calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/demo/video/upload");
    const form = formOf(calls[0]!);
    expect(form).toMatchObject({ public_id: "private/orders/o1/m9", type: "authenticated", overwrite: "false", api_key: "key123" });
    expect(form.file).toContain("/video/download?");
    const { signature, api_key: _k, file: _f, ...signed } = form;
    expect(signature).toBe(cloudinarySign(signed, "s3cret"));
  });

  it("fails clearly when the provider refuses", async () => {
    await expect(storage(fakeFetch(json({ error: { message: "nope" } }, 400)).impl).copy(voiceRef, "private/orders/o1/m9")).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("deleting a file", () => {
  it("sends a signed destroy that also clears the cached copies", async () => {
    const { calls, impl } = fakeFetch(json({ result: "ok" }));
    await storage(impl).remove(productRef, []);
    expect(calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/demo/image/destroy");
    const form = formOf(calls[0]!);
    expect(form).toMatchObject({ public_id: productRef.key, type: "upload", invalidate: "true", api_key: "key123" });
    const { signature, api_key: _k, ...signed } = form;
    expect(signature).toBe(cloudinarySign(signed, "s3cret"));
  });

  it("treats a file that is already gone as deleted, and private files use the authenticated type", async () => {
    const { calls, impl } = fakeFetch(json({ result: "not found" }));
    await expect(storage(impl).remove(voiceRef, [])).resolves.toBeUndefined();
    expect(calls[0]!.url).toContain("/video/destroy");
    expect(formOf(calls[0]!).type).toBe("authenticated");
  });

  it("throws when the provider fails, so the deletion can be retried", async () => {
    await expect(storage(fakeFetch(json({ result: "error" }, 500)).impl).remove(productRef, [])).rejects.toThrow(/could not delete/);
    await expect(storage(fakeFetch(json({ result: "weird" })).impl).remove(productRef, [])).rejects.toThrow(/could not delete/);
    await expect(storage(fakeFetch(new Error("offline")).impl).remove(productRef, [])).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
