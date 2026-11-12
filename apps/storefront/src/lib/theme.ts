/**
 * Darjeeling Stores design system tokens:
 * Primary deep maroon, tea-leaf yellow, warm cream.
 * Exact parity with apps/customer-app/src/theme.ts
 */

export const colors = {
  maroon: "#401815",
  maroonDeep: "#2a0f0d",
  maroonSoft: "#5a2622",
  red: "#c62828",
  redSoft: "#fdeceb",
  yellow: "#ffc933",
  yellowSoft: "#fff4d1",
  cream: "#f7f3ea",
  creamDeep: "#efe8d8",
  card: "#ffffff",
  ink: "#231815",
  muted: "#7a6f66",
  faint: "#b3a99d",
  line: "#ece6da",
  green: "#1f9d62",
  greenSoft: "#e2f5ec",
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
  card: "0 8px 22px rgba(64, 24, 21, 0.08)",
  lift: "0 14px 32px rgba(64, 24, 21, 0.18)",
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
  "#fff4d1",
  "#fde8e6",
  "#e8f3e1",
  "#e6eefb",
  "#f6ebdd",
  "#efe6f7",
];

/** Coupon offer card tints [background, accentForeground] */
export const OFFER_TINTS: [string, string][] = [
  ["#fff4d1", "#d98a00"],
  ["#e2f5ec", "#1f9d62"],
  ["#fde8e6", "#c62828"],
  ["#e5eefc", "#2f6fdb"],
];
