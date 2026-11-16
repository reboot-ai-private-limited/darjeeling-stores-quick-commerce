/** The store's support phone and WhatsApp number. The one place to change it for the whole website. */
export const SUPPORT_PHONE_LABEL = "+91 75479 96919";
export const SUPPORT_PHONE_TEL = "+917547996919";

/** A WhatsApp chat link to the support number, with an optional first message already typed. */
export const whatsappLink = (message = "Hi Darjeeling Stores, I need help") =>
  `https://wa.me/${SUPPORT_PHONE_TEL.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
