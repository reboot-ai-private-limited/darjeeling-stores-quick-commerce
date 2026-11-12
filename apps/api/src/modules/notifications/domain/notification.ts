export type Channel = "push" | "whatsapp" | "sms";
export const CHANNELS: readonly Channel[] = ["push", "whatsapp", "sms"];
export type Category = "utility" | "marketing" | "authentication";
/** Order updates and codes are `transactional` and cannot be switched off; promos and cart reminders need the customer's opt-in. */
export type Purpose = "transactional" | "promo" | "cart_reminder";
export type NotificationStatus = "queued" | "sent" | "delivered" | "failed";

/** Variables a template may use. The server fills them in; a unit test checks every built-in template uses only these. */
export const KNOWN_VARS = [
  "name", "orderNo", "total", "otp", "trackingUrl", "riderName", "riderPhone", "productName", "variantLabel", "itemName", "amount",
  "refundStatus", "status", "code", "minVersion", "link", "reason", "eta", "title", "body",
] as const;

export interface Template {
  key: string; channel: Channel; title: string | null; body: string; whatsappTemplateName: string | null;
  category: Category; language: string;
}

export interface Notification {
  id: string; userId: string | null; templateKey: string; channel: Channel;
  /** What was sent, already filled in. Empty for login codes, which are never stored. */
  title: string | null; body: string | null;
  /** WhatsApp: the approved template and its values in order. */
  whatsapp: { templateName: string; language: string; params: string[]; buttonParams: string[] } | null;
  /** Push: the data message the app reacts to (all values are text). */
  data: Record<string, string>; imageUrl: string | null; priority: "high" | "normal";
  /** Where it goes when the user is not a registered user (login codes), masked. */
  to: string | null;
  status: NotificationStatus; providerMessageId: string | null; error: string | null; attempts: number;
  orderId: string | null; dedupeKey: string | null; lockedUntil: Date | null;
  createdAt: Date; updatedAt: Date; sentAt: Date | null;
}

export interface Prefs { promoPush: boolean; promoWhatsApp: boolean; cartReminders: boolean }
export const DEFAULT_PREFS: Prefs = { promoPush: true, promoWhatsApp: false, cartReminders: false };

const VAR = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Every `{{variable}}` in the text, in order, repeats included. */
export function variablesIn(text: string): string[] { return [...text.matchAll(VAR)].map(m => m[1]!); }

export class MissingVariableError extends Error {
  constructor(readonly variable: string) { super(`The template needs a value for {{${variable}}}`); this.name = "MissingVariableError"; }
}

export type Vars = Record<string, string | number>;

export function render(text: string, vars: Vars): string {
  return text.replace(VAR, (_all, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null) throw new MissingVariableError(name);
    return String(value);
  });
}

/** WhatsApp takes the values in the order the placeholders appear, and refuses empty values and line breaks. */
export function whatsappParams(body: string, vars: Vars): string[] {
  return variablesIn(body).map(name => {
    const value = vars[name];
    if (value === undefined || value === null) throw new MissingVariableError(name);
    return String(value).replace(/\s+/g, " ").trim().slice(0, 1024) || "-";
  });
}

/** Whether a customer's preferences allow this message. */
export function allowedByPrefs(prefs: Prefs, purpose: Purpose, channel: Channel): boolean {
  if (purpose === "transactional") return true;
  if (purpose === "cart_reminder") return prefs.cartReminders;
  return channel === "push" ? prefs.promoPush : channel === "whatsapp" ? prefs.promoWhatsApp : false;
}

const RANK: Record<NotificationStatus, number> = { queued: 0, sent: 1, delivered: 2, failed: 1 };
/** A provider report only ever moves a message forward: a late "sent" never undoes "delivered". */
export function moveForward(current: NotificationStatus, next: NotificationStatus): NotificationStatus {
  if (current === "delivered") return current;
  return RANK[next] >= RANK[current] ? next : current;
}

export function mapWhatsAppStatus(status: string): NotificationStatus | null {
  if (status === "sent") return "sent";
  if (status === "delivered" || status === "read") return "delivered";
  if (status === "failed") return "failed";
  return null;
}

export const maskPhone = (phone: string) => phone.length <= 6 ? "***" : `${phone.slice(0, 3)}${"*".repeat(phone.length - 6)}${phone.slice(-3)}`;
