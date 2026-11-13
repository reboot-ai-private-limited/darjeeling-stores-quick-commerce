import type { OtpTransport } from "./otp.js";

export type StartMessagingConfig = { apiKey: string; templateId: string; appName: string; baseUrl: string };

/**
 * Delivers login codes through StartMessaging (SMS). We generate, hash and check the code ourselves, so only /otp/send is used.
 * StartMessaging sends SMS only, so a WhatsApp request is delivered by SMS as well. The code and the full phone number are never logged.
 */
export function createStartMessagingTransport(config: StartMessagingConfig, fetchImpl: typeof fetch = fetch): OtpTransport {
  return {
    async send({ phone, code, signal }) {
      const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
        body: JSON.stringify({ phoneNumber: phone, templateId: config.templateId, variables: { otp: code, appName: config.appName } }),
        signal,
      });
      if (!response.ok) throw new Error(`StartMessaging answered ${response.status}`);
    },
  };
}
