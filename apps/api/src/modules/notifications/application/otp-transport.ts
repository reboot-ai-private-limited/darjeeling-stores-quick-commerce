import { templatesFor } from "../domain/templates.js";
import { AppError } from "../../catalog/catalog.public.js";
import { maskPhone, render, type Notification } from "../domain/notification.js";
import type { NotificationStore, SmsProvider, WhatsAppProvider } from "./ports.js";

export const OTP_TEMPLATE_KEY = "otp_login";
const DEFAULT_SMS = "Your Darjeeling Stores login code is {{code}}. Valid for 5 minutes.";

export type OtpChannel = "whatsapp" | "sms";
/** What the identity module (Dev 1) calls to deliver a login code. */
export interface OtpTransport { send(phone: string, code: string): Promise<{ channel: OtpChannel }> }

/**
 * Sends a login code by WhatsApp and, if that fails, by SMS. It answers straight away because the person is waiting, so it does
 * not use the job queue. The code itself is never saved; the delivery log keeps only that an attempt was made, to a masked number.
 */
export function createOtpTransport(deps: {
  store: NotificationStore; whatsapp: WhatsAppProvider; sms: SmsProvider; now: () => Date; newId: () => string;
}): OtpTransport {
  const { store, whatsapp, sms, now, newId } = deps;

  async function log(phone: string, channel: OtpChannel, outcome: { messageId: string } | { error: string }) {
    const at = now();
    const entry: Notification = {
      id: newId(), userId: null, templateKey: OTP_TEMPLATE_KEY, channel, title: null, body: null, whatsapp: null, data: {}, imageUrl: null, priority: "high",
      to: maskPhone(phone), status: "messageId" in outcome ? "sent" : "failed", providerMessageId: "messageId" in outcome ? outcome.messageId : null,
      error: "error" in outcome ? outcome.error : null, attempts: 1, orderId: null, dedupeKey: null, lockedUntil: null, createdAt: at, updatedAt: at,
      sentAt: "messageId" in outcome ? at : null,
    };
    await store.insert(entry).catch(() => undefined);
  }

  return {
    async send(phone, code) {
      const templates = templatesFor(OTP_TEMPLATE_KEY);
      const wa = templates.find(t => t.channel === "whatsapp");
      try {
        const sent = await whatsapp.sendTemplate({
          to: phone, templateName: wa?.whatsappTemplateName ?? "login_otp", language: wa?.language ?? "en", params: [code], buttonParams: [code],
        });
        await log(phone, "whatsapp", sent);
        return { channel: "whatsapp" };
      } catch (error) {
        await log(phone, "whatsapp", { error: error instanceof Error ? error.message : "WhatsApp failed" });
      }
      try {
        const text = render(templates.find(t => t.channel === "sms")?.body ?? DEFAULT_SMS, { code });
        const sent = await sms.send({ to: phone, text });
        await log(phone, "sms", sent);
        return { channel: "sms" };
      } catch (error) {
        await log(phone, "sms", { error: error instanceof Error ? error.message : "SMS failed" });
      }
      throw new AppError("OTP_DELIVERY_FAILED", "We could not send the code. Please try again.");
    },
  };
}
