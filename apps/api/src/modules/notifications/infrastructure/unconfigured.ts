import { ProviderError, type PushProvider, type SmsProvider, type WhatsAppProvider } from "../application/ports.js";

const off = (what: string) => new ProviderError(`${what} is not configured on this server`, true, "NOT_CONFIGURED");

/** Used when a provider has no credentials: messages fail with a clear reason in the delivery log, and can be retried once it is set up. */
export const unconfiguredPush: PushProvider = { name: "unconfigured", send: async () => { throw off("Push (FCM)"); } };
export const unconfiguredWhatsApp: WhatsAppProvider = { name: "unconfigured", sendTemplate: async () => { throw off("WhatsApp"); } };
export const unconfiguredSms: SmsProvider = { name: "unconfigured", send: async () => { throw off("SMS"); } };
