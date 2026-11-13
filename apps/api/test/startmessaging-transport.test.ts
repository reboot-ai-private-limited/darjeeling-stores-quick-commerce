import { describe, expect, it, vi } from "vitest";
import { createStartMessagingTransport } from "../src/modules/identity/infrastructure/startmessaging-transport.js";

const config = { apiKey: "sm_live_testkey123", templateId: "tpl_1", appName: "Darjeeling Stores", baseUrl: "https://api.startmessaging.com/" };

describe("StartMessaging transport", () => {
  it("posts the code and app name to /otp/send with the API key", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await createStartMessagingTransport(config, fetchMock as unknown as typeof fetch).send({ phone: "+919876543210", code: "123456", channel: "sms", signal: new AbortController().signal });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.startmessaging.com/otp/send");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("sm_live_testkey123");
    expect(JSON.parse(init.body as string)).toEqual({ phoneNumber: "+919876543210", templateId: "tpl_1", variables: { otp: "123456", appName: "Darjeeling Stores" } });
  });

  it("fails without leaking the code when the provider rejects", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 401 }));
    const send = createStartMessagingTransport(config, fetchMock as unknown as typeof fetch).send({ phone: "+919876543210", code: "123456", channel: "sms", signal: new AbortController().signal });
    await expect(send).rejects.toThrow("StartMessaging answered 401");
  });
});
