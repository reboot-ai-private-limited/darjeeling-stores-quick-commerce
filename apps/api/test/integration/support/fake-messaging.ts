import {
  ProviderError, type AudienceDirectory, type DeviceRegistry, type PushMessage, type PushProvider, type SmsProvider, type UserContacts, type WhatsAppMessage, type WhatsAppProvider,
} from "../../../src/modules/notifications/notifications.public.js";

/**
 * Message providers and the identity lookups held in memory. A test sets who has a phone or a device, makes a provider fail
 * in a chosen way, and reads back exactly what would have been sent.
 */
export function createFakeMessaging() {
  const pushed: PushMessage[] = [];
  const whatsapped: WhatsAppMessage[] = [];
  const texted: { to: string; text: string }[] = [];
  const removedTokens: string[] = [];
  const phones = new Map<string, string>();
  const tokens = new Map<string, string[]>();
  const zones = new Map<string, string[]>();
  const behavior = {
    pushByToken: new Map<string, "invalid" | "transient" | "permanent">(),
    /** One entry per upcoming WhatsApp send: an error to throw, or null to let it through. */
    whatsapp: [] as (ProviderError | null)[],
    whatsappAlways: null as ProviderError | null,
    smsFails: false,
  };

  const push: PushProvider = {
    name: "fake-push",
    async send(message) {
      const how = behavior.pushByToken.get(message.token);
      if (how === "invalid") throw new ProviderError("Requested entity was not found", true, "UNREGISTERED", true);
      if (how === "transient") throw new ProviderError("FCM is busy", false, "UNAVAILABLE");
      if (how === "permanent") throw new ProviderError("Invalid payload", true, "INVALID_ARGUMENT");
      pushed.push(message);
      return { messageId: `fcm-${pushed.length}` };
    },
  };
  const whatsapp: WhatsAppProvider = {
    name: "fake-whatsapp",
    async sendTemplate(message) {
      const planned = behavior.whatsapp.shift();
      if (planned) throw planned;
      if (behavior.whatsappAlways) throw behavior.whatsappAlways;
      whatsapped.push(message);
      return { messageId: `wamid.${whatsapped.length}` };
    },
  };
  const sms: SmsProvider = {
    name: "fake-sms",
    async send(message) {
      if (behavior.smsFails) throw new ProviderError("SMS gateway down", false);
      texted.push(message);
      return { messageId: `sms-${texted.length}` };
    },
  };
  const contacts: UserContacts = { phoneOf: async userId => phones.get(userId) ?? null };
  const devices: DeviceRegistry = {
    tokensFor: async userId => [...(tokens.get(userId) ?? [])],
    removeToken: async token => { removedTokens.push(token); for (const [id, list] of tokens) tokens.set(id, list.filter(t => t !== token)); },
  };
  const audience: AudienceDirectory = {
    async customerIds(zoneIds, afterId, limit) {
      const all = [...new Set(zoneIds.flatMap(z => zones.get(z) ?? []))].sort();
      return all.filter(id => afterId === undefined || id > afterId).slice(0, limit);
    },
  };

  return {
    push, whatsapp, sms, contacts, devices, audience, pushed, whatsapped, texted, removedTokens, behavior,
    /** Gives a customer a phone and push devices. */
    person(userId: string, phone: string | null, deviceTokens: string[] = []) { if (phone) phones.set(userId, phone); else phones.delete(userId); tokens.set(userId, deviceTokens); },
    inZone(zoneId: string, userIds: string[]) { zones.set(zoneId, userIds); },
    reset() {
      pushed.length = 0; whatsapped.length = 0; texted.length = 0; removedTokens.length = 0; phones.clear(); tokens.clear(); zones.clear();
      behavior.pushByToken.clear(); behavior.whatsapp.length = 0; behavior.whatsappAlways = null; behavior.smsFails = false;
    },
  };
}
export type FakeMessaging = ReturnType<typeof createFakeMessaging>;
