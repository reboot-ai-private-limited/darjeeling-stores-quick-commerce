import type { Template } from "./notification.js";

/**
 * Every message the server sends on its own, written here in code (nothing is edited in the admin panel).
 * One entry per message key and channel: customer order and refund updates, rider assignment alerts, back-in-stock, login codes
 * and the promo broadcast. `{{name}}` placeholders are filled in by the server. The WhatsApp names must match templates
 * approved by the WhatsApp provider; changing the wording of a WhatsApp message means getting the provider's approval first.
 */
export const TEMPLATES: readonly Template[] = [
  { key: "back_in_stock", channel: "push", title: "Back in stock", body: "{{productName}} ({{variantLabel}}) is available again. Order now before it sells out.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "back_in_stock", channel: "whatsapp", title: null, body: "Good news! {{productName}} ({{variantLabel}}) is back in stock at Darjeeling Stores. Order now.", whatsappTemplateName: "back_in_stock_v1", category: "utility", language: "en" },
  { key: "assignment_assigned", channel: "push", title: "New order assigned", body: "Order {{orderNo}} is assigned to you. Acknowledge it now.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "handover_assigned", channel: "push", title: "Order handed over to you", body: "Order {{orderNo}} is handed over to you. Acknowledge it now.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "assignment_cancelled", channel: "push", title: "Order taken back", body: "Order {{orderNo}} was taken back by dispatch.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "payment_paid", channel: "push", title: "Already paid", body: "Order {{orderNo}} is already paid. Do not collect cash.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "assignment_unacknowledged", channel: "whatsapp", title: null, body: "{{name}}, order {{orderNo}} is waiting for you to acknowledge. Open the rider app now.", whatsappTemplateName: "assignment_unacknowledged_v1", category: "utility", language: "en" },
  { key: "customer_order_placed", channel: "push", title: "Order placed", body: "Your order {{orderNo}} is placed. We will bring it soon.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "customer_order_confirmed", channel: "push", title: "Order confirmed", body: "Order {{orderNo}} is confirmed and will be packed shortly.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "customer_item_unavailable", channel: "push", title: "An item is unavailable", body: "{{itemName}} in order {{orderNo}} is not available. Your bill has been updated.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "customer_order_cancelled", channel: "push", title: "Order cancelled", body: "Order {{orderNo}} was cancelled. {{reason}}", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "customer_refund_approved", channel: "push", title: "Refund approved", body: "Your refund of ₹{{amount}} for order {{orderNo}} is approved.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "customer_refund_rejected", channel: "push", title: "Refund not approved", body: "We could not approve the refund for order {{orderNo}}. {{reason}}", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "customer_refund_done", channel: "push", title: "Refund paid", body: "Your refund of ₹{{amount}} for order {{orderNo}} has been paid.", whatsappTemplateName: null, category: "utility", language: "en" },
  { key: "customer_refund_done", channel: "whatsapp", title: null, body: "Your refund of ₹{{amount}} for order {{orderNo}} has been paid. Thank you for shopping with Darjeeling Stores.", whatsappTemplateName: "refund_done_v1", category: "utility", language: "en" },
  { key: "otp_login", channel: "whatsapp", title: null, body: "{{code}} is your Darjeeling Stores login code. Do not share it with anyone.", whatsappTemplateName: "login_otp", category: "authentication", language: "en" },
  { key: "otp_login", channel: "sms", title: null, body: "Your Darjeeling Stores login code is {{code}}. Valid for 5 minutes.", whatsappTemplateName: null, category: "authentication", language: "en" },
  // The promo sent from Admin > Notifications > Zone Broadcasts. The title and text are typed by the admin each time.
  { key: "promo_broadcast", channel: "push", title: "{{title}}", body: "{{body}}", whatsappTemplateName: null, category: "marketing", language: "en" },
  { key: "promo_broadcast", channel: "whatsapp", title: null, body: "{{title}} {{body}}", whatsappTemplateName: "promo_broadcast", category: "marketing", language: "en" },
];

/** The built-in messages for one key, one per channel. Empty for an unknown key. */
export const templatesFor = (key: string): Template[] => TEMPLATES.filter(t => t.key === key);
