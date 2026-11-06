import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, importSPKI, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/modules/notifications/application/ports.js";
import { createFcmPush, fcmConfigFromEnv } from "../src/modules/notifications/infrastructure/fcm-push.js";
import { createWhatsAppCloud, whatsappConfigFromEnv } from "../src/modules/notifications/infrastructure/whatsapp-cloud.js";

const NOW = new Date("2026-11-05T10:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
interface Call { url: string; init: RequestInit }
function sequence(...answers: (Response | Error | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    const answer = answers.shift() ?? json({});
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(call) : answer;
  }) as typeof fetch;
  return { calls, impl };
}
const rejects = async (promise: Promise<unknown>) => { try { await promise; } catch (e) { return e as ProviderError; } throw new Error("expected a failure"); };

describe("push through Firebase", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const account = { projectId: "darjeeling-demo", clientEmail: "svc@darjeeling-demo.iam.gserviceaccount.com", privateKey };
  const login = () => json({ access_token: "ya29.token", expires_in: 3600 });
  const message = { token: "tok-1", title: "Back in stock", body: "Tomato is back", imageUrl: "https://cdn/320.webp", data: { type: "back_in_stock", productId: "p1" }, priority: "high" as const };

  it("logs in with a signed token that proves the service account, then sends the message", async () => {
    const { calls, impl } = sequence(login(), json({ name: "projects/darjeeling-demo/messages/0:123" }));
    const sent = await createFcmPush({ ...account, fetch: impl, now: () => NOW }).send(message);
    expect(sent.messageId).toBe("projects/darjeeling-demo/messages/0:123");

    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion")!;
    const { payload } = await jwtVerify(assertion, await importSPKI(publicKey, "RS256"), { audience: "https://oauth2.googleapis.com/token", issuer: account.clientEmail, currentDate: NOW });
    expect(payload).toMatchObject({ scope: "https://www.googleapis.com/auth/firebase.messaging", sub: account.clientEmail });
    expect(decodeJwt(assertion).exp! - decodeJwt(assertion).iat!).toBe(3600);

    expect(calls[1]!.url).toBe("https://fcm.googleapis.com/v1/projects/darjeeling-demo/messages:send");
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer ya29.token");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ message: {
      token: "tok-1", data: { type: "back_in_stock", productId: "p1" },
      notification: { title: "Back in stock", body: "Tomato is back", image: "https://cdn/320.webp" },
      android: { priority: "HIGH" }, apns: { headers: { "apns-priority": "10" } },
    } });
  });

  it("sends a data-only message at normal priority when there is no text, and reuses the login", async () => {
    const { calls, impl } = sequence(login(), json({ name: "m1" }), json({ name: "m2" }));
    const push = createFcmPush({ ...account, fetch: impl, now: () => NOW });
    await push.send({ token: "a", data: { type: "assignment" }, priority: "normal" });
    await push.send({ token: "b", data: { type: "assignment" }, priority: "normal" });
    expect(calls.map(c => c.url).filter(u => u.includes("oauth2"))).toHaveLength(1);
    const body = JSON.parse(String(calls[1]!.init.body)).message;
    expect(body).not.toHaveProperty("notification");
    expect(body.android.priority).toBe("NORMAL");
  });

  it("logs in again after the login is about to expire, and once more if Firebase refuses it", async () => {
    let clock = NOW;
    const { calls, impl } = sequence(login(), json({ name: "m1" }), login(), json({ name: "m2" }), json({}, 401), login(), json({ name: "m3" }));
    const push = createFcmPush({ ...account, fetch: impl, now: () => clock });
    await push.send(message);
    clock = new Date(NOW.getTime() + 3_560_000);
    await push.send(message);
    await push.send(message);
    expect(calls.filter(c => c.url.includes("oauth2"))).toHaveLength(3);
  });

  it("tells a token that is no longer valid apart from other failures", async () => {
    const gone = async (response: Response) => rejects(createFcmPush({ ...account, fetch: sequence(login(), response).impl, now: () => NOW }).send(message));
    const unregistered = await gone(json({ error: { status: "NOT_FOUND", message: "Requested entity was not found.", details: [{ errorCode: "UNREGISTERED" }] } }, 404));
    expect(unregistered).toMatchObject({ permanent: true, invalidToken: true, code: "UNREGISTERED" });
    const badToken = await gone(json({ error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } }, 400));
    expect(badToken).toMatchObject({ permanent: true, invalidToken: true });
    const badPayload = await gone(json({ error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } }, 400));
    expect(badPayload).toMatchObject({ permanent: true, invalidToken: false });
  });

  it("calls overload and outages transient, and unreachable Firebase transient too", async () => {
    const push = (response: Response | Error) => createFcmPush({ ...account, fetch: sequence(login(), response).impl, now: () => NOW });
    expect(await rejects(push(json({ error: { status: "UNAVAILABLE", message: "try later" } }, 503)).send(message))).toMatchObject({ permanent: false });
    expect(await rejects(push(json({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }, 429)).send(message))).toMatchObject({ permanent: false });
    expect(await rejects(push(new Error("offline")).send(message))).toMatchObject({ permanent: false });
    expect(await rejects(createFcmPush({ ...account, fetch: sequence(json({ error: "invalid_grant" }, 400)).impl, now: () => NOW }).send(message))).toMatchObject({ permanent: true, code: "AUTH" });
  });

  it("reads the service account from the environment, from JSON text or a file", () => {
    const json = JSON.stringify({ project_id: "p", client_email: "e@x", private_key: "k" });
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: json })).toEqual({ projectId: "p", clientEmail: "e@x", privateKey: "k" });
    expect(fcmConfigFromEnv({})).toBeUndefined();
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: "not json" })).toBeUndefined();
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "p" }) })).toBeUndefined();
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_FILE: "D:/does/not/exist.json" })).toBeUndefined();
  });
});

describe("WhatsApp Cloud API", () => {
  const config = { phoneNumberId: "1055", accessToken: "EAAB-token" };
  const order = { to: "+919876543210", templateName: "order_confirmed_v1", language: "en", params: ["Asha", "DS-240001-A"] };

  it("sends the approved template with its values in order and no plus sign on the number", async () => {
    const { calls, impl } = sequence(json({ messages: [{ id: "wamid.ABC" }] }));
    expect(await createWhatsAppCloud({ ...config, fetch: impl }).sendTemplate(order)).toEqual({ messageId: "wamid.ABC" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/1055/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer EAAB-token");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      messaging_product: "whatsapp", to: "919876543210", type: "template",
      template: { name: "order_confirmed_v1", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Asha" }, { type: "text", text: "DS-240001-A" }] }] },
    });
  });

  it("adds the copy-code button for login codes, and leaves the body out when there are no values", async () => {
    const { calls, impl } = sequence(json({ messages: [{ id: "a" }] }), json({ messages: [{ id: "b" }] }));
    const wa = createWhatsAppCloud({ ...config, fetch: impl });
    await wa.sendTemplate({ to: "+919876543210", templateName: "login_otp", language: "en", params: ["482913"], buttonParams: ["482913"] });
    await wa.sendTemplate({ to: "+919876543210", templateName: "hello", language: "en", params: [] });
    expect(JSON.parse(String(calls[0]!.init.body)).template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
    ]);
    expect(JSON.parse(String(calls[1]!.init.body)).template.components).toEqual([]);
  });

  it("treats template and number problems as permanent, and rate limits and outages as worth retrying", async () => {
    const failure = async (response: Response | Error) => rejects(createWhatsAppCloud({ ...config, fetch: sequence(response).impl }).sendTemplate(order));
    expect(await failure(json({ error: { code: 132001, message: "Template name does not exist", error_data: { details: "template not approved" } } }, 400)))
      .toMatchObject({ permanent: true, code: "132001", message: "template not approved" });
    expect(await failure(json({ error: { code: 131026, message: "Message undeliverable" } }, 400))).toMatchObject({ permanent: true });
    expect(await failure(json({ error: { code: 190, message: "Invalid OAuth access token" } }, 401))).toMatchObject({ permanent: true });
    expect(await failure(json({ error: { code: 130429, message: "Rate limit hit" } }, 400))).toMatchObject({ permanent: false });
    expect(await failure(json({ error: { code: 4, message: "Too many calls" } }, 400))).toMatchObject({ permanent: false });
    expect(await failure(json({}, 429))).toMatchObject({ permanent: false });
    expect(await failure(json({}, 503))).toMatchObject({ permanent: false });
    expect(await failure(new Error("offline"))).toMatchObject({ permanent: false });
    expect(await failure(json({ messages: [] }, 200))).toMatchObject({ permanent: true });
  });

  it("reads its settings from the environment", () => {
    expect(whatsappConfigFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_API_VERSION: "v22.0" })).toEqual({ phoneNumberId: "1", accessToken: "t", apiVersion: "v22.0" });
    expect(whatsappConfigFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "1" })).toBeUndefined();
  });
});
