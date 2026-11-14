import { Platform, type TextStyle, type ViewStyle } from "react-native";

/** Darjeeling Stores brand: deep maroon, tea-leaf yellow, warm cream. */
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

export const radius = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
/** Home page rhythm: the gap between sections, and between a section title and what it introduces. */
export const SECTION_GAP = space.xxl;
export const TITLE_GAP = space.md;

export const shadow = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: "#401815", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 3 },
    default: { boxShadow: "0 8px 22px rgba(64,24,21,0.08)" } as ViewStyle,
  })!,
  lift: Platform.select<ViewStyle>({
    ios: { shadowColor: "#401815", shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
    android: { elevation: 8 },
    default: { boxShadow: "0 14px 32px rgba(64,24,21,0.18)" } as ViewStyle,
  })!,
};

export const type = {
  display: { fontSize: 34, fontWeight: "800", letterSpacing: -1, color: colors.ink } as TextStyle,
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.6, color: colors.ink } as TextStyle,
  h2: { fontSize: 19, fontWeight: "700", letterSpacing: -0.3, color: colors.ink } as TextStyle,
  body: { fontSize: 15, fontWeight: "500", color: colors.ink, lineHeight: 21 } as TextStyle,
  small: { fontSize: 13, fontWeight: "500", color: colors.muted, lineHeight: 18 } as TextStyle,
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, color: colors.muted, textTransform: "uppercase" } as TextStyle,
};

/** Money is whole paise everywhere in the API. */
export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
