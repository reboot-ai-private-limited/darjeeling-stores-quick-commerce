/** The digits of a phone number as a dialable +91 number, whatever shape it arrives in ("+919800000010", "98000 00010", "09800000010"). */
export function dialNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length >= 10 ? digits.slice(-10) : digits;
  return digits.length >= 10 ? `+91${ten}` : raw.trim();
}

/** "+919800000010" -> "+91 98000 00010", so a number reads in two short groups and is easy to check. */
export function prettyPhone(raw: string): string {
  const dial = dialNumber(raw);
  return dial.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");
}

/** The number for a WhatsApp chat link: digits only, with the country code. */
export const whatsappNumber = (raw: string): string => dialNumber(raw).replace(/\D/g, "");
