/**
 * Darjeeling Stores design system tokens:
 * Primary deep maroon, tea-leaf yellow, warm cream.
 * Exact parity with apps/customer-app/src/theme.ts
 */

export const colors = {
  maroon: "#0F5B43",
  maroonDeep: "#0A3F2E",
  maroonSoft: "#1A7457",
  red: "#c62828",
  redSoft: "#fdeceb",
  yellow: "#CFB264",
  yellowSoft: "#D7EFD9",
  cream: "#F7FCF6",
  creamDeep: "#D7EFD9",
  card: "#ffffff",
  ink: "#17302A",
  muted: "#5F7468",
  faint: "#9DB2A5",
  line: "#CFE6D1",
  green: "#63A96E",
  greenSoft: "#D7EFD9",
  amber: "#d98a00",
  amberSoft: "#fff1d6",
  blue: "#2f6fdb",
  blueSoft: "#e5eefc",
  white: "#ffffff",
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 9999,
};

export const shadows = {
  card: "0 8px 22px rgba(15,91,67, 0.08)",
  lift: "0 14px 32px rgba(15,91,67, 0.18)",
};

/** Formats whole paise into Indian Rupee display (e.g. 19900 -> ₹199). */
export const rupees = (paise: number) => {
  const val = paise / 100;
  return `₹${val.toLocaleString("en-IN", {
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

/** Category tile background tints (same 6 pastel tints as mobile app) */
export const CATEGORY_TINTS = [
  "#D7EFD9",
  "#D7EFD9",
  "#D7EFD9",
  "#D7EFD9",
  "#D7EFD9",
  "#D7EFD9",
];

/** Coupon offer card tints [background, accentForeground] */
export const OFFER_TINTS: [string, string][] = [
  ["#D7EFD9", "#d98a00"],
  ["#D7EFD9", "#63A96E"],
  ["#fde8e6", "#c62828"],
  ["#e5eefc", "#2f6fdb"],
];
