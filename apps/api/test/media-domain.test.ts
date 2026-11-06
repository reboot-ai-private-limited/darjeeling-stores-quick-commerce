import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, KINDS, ORDER_COPY_OF, RULES, addDays, canUpload, checkDeclared, checkUploaded, deleteBackoffMs, hasAny, maxBytesFor, storageKey,
  type Principal,
} from "../src/modules/media/domain/media.js";

const person = (kind: Principal["kind"], permissions: string[] = []): Principal => ({ userId: "u1", kind, role: kind, permissions, scope: { all: true, warehouseIds: [] } });
const photo = { contentType: "image/jpeg", sizeBytes: 100_000, durationSec: null };
const voice = { contentType: "audio/mp4", sizeBytes: 84_210, durationSec: 8 };

describe("who may upload what", () => {
  it("lets customers upload address and refund files, riders upload delivery evidence, and staff upload catalog images", () => {
    expect(canUpload(person("customer"), RULES.address_voice)).toBe(true);
    expect(canUpload(person("customer"), RULES.address_photo)).toBe(true);
    expect(canUpload(person("customer"), RULES.refund_photo)).toBe(true);
    expect(canUpload(person("rider"), RULES.failed_delivery_photo)).toBe(true);
    expect(canUpload(person("rider"), RULES.rider_photo)).toBe(true);
    expect(canUpload(person("staff", ["catalog:manage"]), RULES.product_image)).toBe(true);
    expect(canUpload(person("staff", ["pricing:manage"]), RULES.banner)).toBe(true);
    expect(canUpload(person("staff", ["riders:manage"]), RULES.rider_photo)).toBe(true);
    expect(canUpload(person("staff", ["*"]), RULES.category_image)).toBe(true);
  });

  it("refuses everyone else, and refuses all uploads of copies that only the server makes", () => {
    expect(canUpload(person("customer"), RULES.product_image)).toBe(false);
    expect(canUpload(person("rider"), RULES.address_voice)).toBe(false);
    expect(canUpload(person("customer"), RULES.failed_delivery_photo)).toBe(false);
    expect(canUpload(person("staff", ["catalog:view"]), RULES.product_image)).toBe(false);
    expect(canUpload(person("staff", ["catalog:manage"]), RULES.banner)).toBe(false);
    for (const kind of ["order_voice", "order_photo"] as const) {
      for (const who of [person("customer"), person("rider"), person("staff", ["*"])]) expect(canUpload(who, RULES[kind])).toBe(false);
    }
  });

  it("matches permission keys and the all-permissions key", () => {
    expect(hasAny(person("staff", ["*"]), ["x"])).toBe(true);
    expect(hasAny(person("staff", ["a", "b"]), ["b"])).toBe(true);
    expect(hasAny(person("staff", ["a"]), ["b"])).toBe(false);
  });
});

describe("the declared file", () => {
  it("accepts a normal photo and a short voice note", () => {
    expect(checkDeclared(RULES.product_image, photo, DEFAULT_SETTINGS)).toBeNull();
    expect(checkDeclared(RULES.address_voice, voice, DEFAULT_SETTINGS)).toBeNull();
  });

  it("rejects the wrong type, a file over the limit and a recording over ten seconds", () => {
    expect(checkDeclared(RULES.product_image, { ...photo, contentType: "application/pdf" }, DEFAULT_SETTINGS)).toBe("type_not_allowed");
    expect(checkDeclared(RULES.product_image, { ...photo, contentType: "audio/mp4" }, DEFAULT_SETTINGS)).toBe("type_not_allowed");
    expect(checkDeclared(RULES.address_voice, { ...voice, contentType: "image/png" }, DEFAULT_SETTINGS)).toBe("type_not_allowed");
    expect(checkDeclared(RULES.product_image, { ...photo, sizeBytes: 5 * 1024 * 1024 + 1 }, DEFAULT_SETTINGS)).toBe("too_large");
    expect(checkDeclared(RULES.product_image, { ...photo, sizeBytes: 5 * 1024 * 1024 }, DEFAULT_SETTINGS)).toBeNull();
    expect(checkDeclared(RULES.address_voice, { ...voice, sizeBytes: 500 * 1024 + 1 }, DEFAULT_SETTINGS)).toBe("too_large");
    expect(checkDeclared(RULES.address_voice, { ...voice, durationSec: 10.1 }, DEFAULT_SETTINGS)).toBe("too_long");
    expect(checkDeclared(RULES.address_voice, { ...voice, durationSec: 10 }, DEFAULT_SETTINGS)).toBeNull();
  });

  it("uses the configured limits", () => {
    const tight = { ...DEFAULT_SETTINGS, maxImageBytes: 1000, maxVoiceSeconds: 3 };
    expect(maxBytesFor(RULES.product_image, tight)).toBe(1000);
    expect(maxBytesFor(RULES.address_voice, tight)).toBe(500 * 1024);
    expect(checkDeclared(RULES.product_image, photo, tight)).toBe("too_large");
    expect(checkDeclared(RULES.address_voice, voice, tight)).toBe("too_long");
  });
});

describe("the file that was really uploaded", () => {
  it("checks the measured size and length, with a small tolerance on length", () => {
    expect(checkUploaded(RULES.product_image, { bytes: 6 * 1024 * 1024, durationSec: null }, DEFAULT_SETTINGS)).toBe("too_large");
    expect(checkUploaded(RULES.product_image, { bytes: 1000, durationSec: null }, DEFAULT_SETTINGS)).toBeNull();
    expect(checkUploaded(RULES.address_voice, { bytes: 1000, durationSec: 10.4 }, DEFAULT_SETTINGS)).toBeNull();
    expect(checkUploaded(RULES.address_voice, { bytes: 1000, durationSec: 10.6 }, DEFAULT_SETTINGS)).toBe("too_long");
    expect(checkUploaded(RULES.address_voice, { bytes: 1000, durationSec: null }, DEFAULT_SETTINGS)).toBeNull();
  });
});

describe("keys, retention and retry timing", () => {
  it("builds storage keys from random ids only, in the folder for the kind", () => {
    expect(storageKey(RULES.product_image, "p1", "m1")).toBe("public/products/p1/m1");
    expect(storageKey(RULES.address_voice, null, "m1")).toBe("private/addresses/unassigned/m1");
    expect(storageKey(RULES.order_photo, "o1", "m2")).toBe("private/orders/o1/m2");
    expect(storageKey(RULES.refund_photo, "o1", "m3")).toBe("private/evidence/o1/m3");
  });

  it("keeps public files under public/ and every private file under private/", () => {
    for (const kind of KINDS) expect(RULES[kind].prefix.startsWith(RULES[kind].access === "public" ? "public/" : "private/"), kind).toBe(true);
  });

  it("copies an address voice note and photo onto the order as order files", () => {
    expect(ORDER_COPY_OF).toEqual({ address_voice: "order_voice", address_photo: "order_photo" });
  });

  it("adds retention days and backs off from one minute up to an hour", () => {
    expect(addDays(new Date("2026-11-05T10:00:00Z"), 7).toISOString()).toBe("2026-11-12T10:00:00.000Z");
    expect([0, 1, 2, 3, 4, 7, 10, 20].map(deleteBackoffMs)).toEqual([60_000, 60_000, 120_000, 240_000, 480_000, 3_600_000, 3_600_000, 3_600_000]);
  });
});
