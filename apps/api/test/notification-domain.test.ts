import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS, KNOWN_VARS, MissingVariableError, allowedByPrefs, mapWhatsAppStatus, maskPhone, moveForward, render, variablesIn, whatsappParams,
} from "../src/modules/notifications/domain/notification.js";
import { deliveryReportsIn, verifyMetaSignature } from "../src/modules/notifications/domain/webhook.js";
import { TEMPLATES, templatesFor } from "../src/modules/notifications/domain/templates.js";

describe("template variables", () => {
  it("finds every placeholder in order, repeats included, tolerating spaces", () => {
    expect(variablesIn("Hi {{name}}, order {{ orderNo }} total {{total}}. {{name}} again")).toEqual(["name", "orderNo", "total", "name"]);
    expect(variablesIn("no placeholders { here }")).toEqual([]);
  });

  it("fills them in, and refuses a missing value instead of sending a blank", () => {
    expect(render("Hi {{name}}, ₹{{total}}", { name: "Asha", total: 399 })).toBe("Hi Asha, ₹399");
    expect(() => render("Hi {{name}}", {})).toThrow(MissingVariableError);
    try { render("{{a}} {{b}}", { a: "1" }); } catch (e) { expect((e as MissingVariableError).variable).toBe("b"); }
    expect(render("0 is a value: {{n}}", { n: 0 })).toBe("0 is a value: 0");
  });

  it("gives WhatsApp the values in placeholder order, cleaned up", () => {
    expect(whatsappParams("{{name}} ordered {{productName}} ({{name}})", { name: "Asha", productName: "Tomato" })).toEqual(["Asha", "Tomato", "Asha"]);
    expect(whatsappParams("{{a}} {{b}}", { a: "line one\nline two\t  x", b: "   " })).toEqual(["line one line two x", "-"]);
    expect(whatsappParams("{{a}}", { a: "x".repeat(2000) })[0]).toHaveLength(1024);
    expect(() => whatsappParams("{{a}}", {})).toThrow(MissingVariableError);
  });

  it("knows the variables the server can fill", () => {
    for (const name of ["name", "orderNo", "otp", "code", "productName", "variantLabel", "title", "body"]) expect(KNOWN_VARS).toContain(name);
  });
});

describe("customer preferences", () => {
  it("never switches off order updates and codes", () => {
    const off = { promoPush: false, promoWhatsApp: false, cartReminders: false };
    for (const channel of ["push", "whatsapp", "sms"] as const) expect(allowedByPrefs(off, "transactional", channel)).toBe(true);
  });

  it("sends promos only on the channel the customer allowed, and never by SMS", () => {
    expect(allowedByPrefs(DEFAULT_PREFS, "promo", "push")).toBe(true);
    expect(allowedByPrefs(DEFAULT_PREFS, "promo", "whatsapp")).toBe(false);
    expect(allowedByPrefs({ ...DEFAULT_PREFS, promoWhatsApp: true }, "promo", "whatsapp")).toBe(true);
    expect(allowedByPrefs({ promoPush: true, promoWhatsApp: true, cartReminders: true }, "promo", "sms")).toBe(false);
  });

  it("sends cart reminders only to those who opted in", () => {
    expect(allowedByPrefs(DEFAULT_PREFS, "cart_reminder", "push")).toBe(false);
    expect(allowedByPrefs({ ...DEFAULT_PREFS, cartReminders: true }, "cart_reminder", "push")).toBe(true);
  });
});

describe("delivery status", () => {
  it("only ever moves a message forward", () => {
    expect(moveForward("queued", "sent")).toBe("sent");
    expect(moveForward("sent", "delivered")).toBe("delivered");
    expect(moveForward("delivered", "sent")).toBe("delivered");
    expect(moveForward("delivered", "failed")).toBe("delivered");
    expect(moveForward("sent", "queued")).toBe("sent");
    expect(moveForward("sent", "failed")).toBe("failed");
  });

  it("maps WhatsApp's words to ours, counting 'read' as delivered", () => {
    expect(mapWhatsAppStatus("sent")).toBe("sent");
    expect(mapWhatsAppStatus("delivered")).toBe("delivered");
    expect(mapWhatsAppStatus("read")).toBe("delivered");
    expect(mapWhatsAppStatus("failed")).toBe("failed");
    expect(mapWhatsAppStatus("deleted")).toBeNull();
  });

  it("masks phone numbers", () => {
    expect(maskPhone("+919876543210")).toBe("+91*******210");
    expect(maskPhone("12345")).toBe("***");
  });
});

describe("WhatsApp webhook signature", () => {
  const secret = "app-secret";
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const sign = (raw: Buffer, key = secret) => `sha256=${createHmac("sha256", key).update(raw).digest("hex")}`;

  it("accepts the exact bytes signed with the app secret", () => {
    expect(verifyMetaSignature(body, sign(body), secret)).toBe(true);
  });
  it("rejects a wrong secret, a changed body, a missing or malformed header and a missing body", () => {
    expect(verifyMetaSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyMetaSignature(Buffer.from(`${body} `), sign(body), secret)).toBe(false);
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", secret)).toBe(false);
    expect(verifyMetaSignature(body, sign(body).replace("sha256=", ""), secret)).toBe(false);
    expect(verifyMetaSignature(undefined, sign(body), secret)).toBe(false);
  });
});

describe("reading WhatsApp status updates", () => {
  it("collects the statuses, with an error message when there is one", () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [
      { id: "wamid.1", status: "delivered" },
      { id: "wamid.2", status: "failed", errors: [{ code: 131026, title: "Undeliverable", message: "Message undeliverable" }] },
      { id: "wamid.3", status: "failed", errors: [{ title: "Only a title" }] },
    ] } }] }] };
    expect(deliveryReportsIn(payload)).toEqual([
      { id: "wamid.1", status: "delivered" }, { id: "wamid.2", status: "failed", error: "Message undeliverable" }, { id: "wamid.3", status: "failed", error: "Only a title" },
    ]);
  });
  it("ignores customer replies and anything that is not shaped like a status", () => {
    expect(deliveryReportsIn({ entry: [{ changes: [{ value: { messages: [{ from: "9198", text: { body: "hi" } }] } }] }] })).toEqual([]);
    expect(deliveryReportsIn({ entry: [{ changes: [{ value: { statuses: [{ id: 5, status: "sent" }, { status: "sent" }, null] } }] }] })).toEqual([]);
    for (const junk of [null, {}, { entry: "x" }, { entry: [null] }, { entry: [{ changes: "x" }] }]) expect(deliveryReportsIn(junk)).toEqual([]);
  });
});

describe("the built-in messages", () => {
  it("has exactly one message per key and channel", () => {
    const ids = TEMPLATES.map(t => `${t.key}:${t.channel}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("uses only variables the server can fill in", () => {
    for (const t of TEMPLATES) for (const name of [...variablesIn(t.body), ...variablesIn(t.title ?? "")]) {
      expect(KNOWN_VARS as readonly string[], `${t.key}/${t.channel} uses {{${name}}}`).toContain(name);
    }
  });
  it("gives WhatsApp the provider's template name and nothing else", () => {
    for (const t of TEMPLATES) {
      if (t.channel === "whatsapp") expect(t.whatsappTemplateName, `${t.key} needs the approved WhatsApp name`).toMatch(/^[a-z0-9_]+$/);
      else expect(t.whatsappTemplateName, `${t.key}/${t.channel}`).toBeNull();
    }
  });
  it("gives only push a title, and keeps marketing off SMS", () => {
    for (const t of TEMPLATES) {
      if (t.channel === "push") expect(t.title, `${t.key} push title`).toBeTruthy();
      else expect(t.title, `${t.key}/${t.channel}`).toBeNull();
      if (t.channel === "sms") expect(t.category).not.toBe("marketing");
    }
  });
  it("covers every order step, refund, rider alert, back-in-stock, login code and the promo", () => {
    const has = (key: string, channel: string) => templatesFor(key).some(t => t.channel === channel);
    for (const key of ["customer_order_placed", "customer_order_confirmed", "customer_item_unavailable", "customer_order_cancelled", "customer_refund_approved", "customer_refund_rejected", "customer_refund_done", "back_in_stock", "assignment_assigned", "handover_assigned", "assignment_cancelled", "payment_paid", "promo_broadcast"]) {
      expect(has(key, "push"), `${key} push`).toBe(true);
    }
    expect(has("assignment_unacknowledged", "whatsapp")).toBe(true);
    expect(has("otp_login", "whatsapp") && has("otp_login", "sms")).toBe(true);
    expect(has("promo_broadcast", "whatsapp")).toBe(true);
    expect(templatesFor("nope")).toEqual([]);
  });
});
