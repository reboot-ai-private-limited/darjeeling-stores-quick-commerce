import { ProviderError, type WhatsAppProvider } from "../application/ports.js";

export interface WhatsAppConfig {
  phoneNumberId: string; accessToken: string; apiVersion?: string; graphUrl?: string;
  fetch?: typeof fetch; timeoutMs?: number;
}

export function whatsappConfigFromEnv(env: NodeJS.ProcessEnv): WhatsAppConfig | undefined {
  const { WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_ACCESS_TOKEN: accessToken } = env;
  return phoneNumberId && accessToken ? { phoneNumberId, accessToken, ...(env.WHATSAPP_API_VERSION && { apiVersion: env.WHATSAPP_API_VERSION }) } : undefined;
}

/** Meta error codes that mean "slow down" rather than "this message can never be sent". */
const RETRYABLE_CODES = new Set([4, 80007, 130429, 131048, 131056, 133016]);

/** WhatsApp Business Cloud API: approved templates only, values in order. */
export function createWhatsAppCloud(config: WhatsAppConfig): WhatsAppProvider {
  const http = config.fetch ?? fetch;
  const timeout = config.timeoutMs ?? 15_000;
  const base = (config.graphUrl ?? "https://graph.facebook.com").replace(/\/+$/, "");
  const version = config.apiVersion ?? "v21.0";

  return {
    name: "whatsapp-cloud",
    async sendTemplate({ to, templateName, language, params, buttonParams }) {
      const components: object[] = [];
      if (params.length > 0) components.push({ type: "body", parameters: params.map(text => ({ type: "text", text })) });
      // Login-code templates carry a "copy code" button that needs the code again.
      buttonParams?.forEach((text, index) => components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text }] }));
      let response: Response;
      try {
        response = await http(`${base}/${version}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
          method: "POST", headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeout),
          body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template", template: { name: templateName, language: { code: language }, components } }),
        });
      } catch { throw new ProviderError("Could not reach WhatsApp", false); }
      const body = (await response.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { code?: number; message?: string; error_data?: { details?: string } } };
      const id = body.messages?.[0]?.id;
      if (response.ok && id) return { messageId: id };
      const code = body.error?.code;
      const text = body.error?.error_data?.details ?? body.error?.message ?? `WhatsApp answered ${response.status}`;
      const retryable = response.status === 429 || response.status >= 500 || (code !== undefined && RETRYABLE_CODES.has(code));
      throw new ProviderError(text, !retryable, code === undefined ? String(response.status) : String(code));
    },
  };
}
