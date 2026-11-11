import { Feather } from "@expo/vector-icons";
import { liftIn } from "../motion";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, space, type } from "../theme";

export type IconName = React.ComponentProps<typeof Feather>["name"];
export const Icon = ({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) => <Feather name={name} size={size} color={color} />;

export const tap = (style: "light" | "medium" | "success" = "light") => {
  // Haptics are a nicety. The native part can be missing (web, some emulators, an Expo Go that does not match the SDK), and then the
  // call fails inside a promise, which try/catch alone does not catch, so the promise's own failure is swallowed too.
  try {
    const done = style === "success"
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(style === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    done.catch(() => undefined);
  } catch { /* haptics are optional */ }
};

/** Fades and lifts its children in, one after another. `i` is the position in the sequence. */
export function Stagger({ i = 0, children, style }: { i?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Animated.View entering={liftIn(80 + i * 70)} style={style}>{children}</Animated.View>;
}

export function Screen({ children, scroll = false, pad = true, bottomPad = 24, style, dark = false }: { children: ReactNode; scroll?: boolean; pad?: boolean; bottomPad?: number; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  const insets = useSafeAreaInsets();
  const base: ViewStyle = { flex: 1, backgroundColor: dark ? colors.maroon : colors.cream, paddingTop: insets.top };
  const inner: ViewStyle = { paddingHorizontal: pad ? space.xl : 0, paddingBottom: insets.bottom + bottomPad };
  if (scroll) return <View style={[base, style]}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={inner} keyboardShouldPersistTaps="handled">{children}</ScrollView></View>;
  return <View style={[base, style]}><View style={[{ flex: 1 }, inner]}>{children}</View></View>;
}

export function Header({ title, subtitle, back = true, right, light = false }: { title?: string; subtitle?: string; back?: boolean; right?: ReactNode; light?: boolean }) {
  const fg = light ? colors.white : colors.ink;
  return (
    <View style={s.header}>
      {back ? (
        <Press onPress={() => router.back()} style={[s.iconBtn, light && { backgroundColor: "rgba(255,255,255,0.14)" }]} haptic>
          <Icon name="arrow-left" color={fg} />
        </Press>
      ) : <View style={{ width: 44 }} />}
      <View style={{ flex: 1, paddingHorizontal: space.md }}>
        {title && <Text style={[type.h2, { color: fg, textAlign: "center" }]} numberOfLines={1}>{title}</Text>}
        {subtitle && <Text style={[type.small, { textAlign: "center", color: light ? "rgba(255,255,255,0.7)" : colors.muted }]} numberOfLines={1}>{subtitle}</Text>}
      </View>
      <View style={{ width: 44, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

const LAYOUT_KEYS = ["flex", "flexGrow", "flexShrink", "flexBasis", "width", "minWidth", "maxWidth", "alignSelf", "margin", "marginTop", "marginBottom", "marginLeft", "marginRight", "marginHorizontal", "marginVertical", "position", "top", "left", "right", "bottom"];

/** Splits a style into the part that positions the control (goes on the animated wrapper) and the part that paints it. */
function splitLayout(style: StyleProp<ViewStyle>) {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const layout: Record<string, unknown> = {}; const paint: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (LAYOUT_KEYS.includes(k) ? layout : paint)[k] = v;
  return { layout: layout as ViewStyle, paint: paint as ViewStyle };
}

/** A pressable that gently shrinks while held and springs back. Flex and width go on the wrapper so it sizes correctly inside rows. */
export function Press({ children, onPress, style, haptic = false, disabled = false, scaleTo = 0.96 }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; haptic?: boolean; disabled?: boolean; scaleTo?: number }) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const { layout, paint } = splitLayout(style);
  return (
    <Animated.View style={[layout, anim]}>
      <Pressable
        disabled={disabled}
        onPress={() => { if (haptic) tap(); onPress?.(); }}
        onPressIn={() => { scale.value = withTiming(scaleTo, { duration: 90 }); }}
        onPressOut={() => { scale.value = withTiming(1, { duration: 140 }); }}
        style={paint}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

type Variant = "primary" | "accent" | "ghost" | "danger" | "soft";
export function Button({ label, onPress, variant = "primary", icon, disabled, style }: { label: string; onPress?: () => void; variant?: Variant; icon?: IconName; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = { primary: colors.maroon, accent: colors.yellow, ghost: "transparent", danger: colors.red, soft: colors.creamDeep }[variant];
  const fg = { primary: colors.white, accent: colors.maroon, ghost: colors.maroon, danger: colors.white, soft: colors.maroon }[variant];
  return (
    <Press onPress={onPress} haptic disabled={disabled} style={[s.button, { backgroundColor: bg, opacity: disabled ? 0.45 : 1 }, variant === "ghost" && { borderWidth: 1.5, borderColor: colors.line }, variant === "primary" && shadow.lift, style]}>
      {icon && <Icon name={icon} color={fg} size={19} />}
      <Text style={[s.buttonText, { color: fg }]}>{label}</Text>
    </Press>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.card, style]}>{children}</View>;

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Press onPress={onPress} haptic style={[s.chip, active && { backgroundColor: colors.maroon, borderColor: colors.maroon }]}>
      {icon && <Icon name={icon} size={15} color={active ? colors.white : colors.muted} />}
      <Text style={{ fontSize: 13, fontWeight: "700", color: active ? colors.white : colors.ink }}>{label}</Text>
    </Press>
  );
}

export function Pill({ label, tone = "green", icon }: { label: string; tone?: "green" | "amber" | "red" | "blue" | "maroon"; icon?: IconName }) {
  const map = { green: [colors.greenSoft, colors.green], amber: [colors.amberSoft, colors.amber], red: [colors.redSoft, colors.red], blue: [colors.blueSoft, colors.blue], maroon: [colors.creamDeep, colors.maroon] }[tone];
  return (
    <View style={[s.pill, { backgroundColor: map[0] }]}>
      {icon && <Icon name={icon} size={12} color={map[1]} />}
      <Text style={{ fontSize: 11, fontWeight: "800", color: map[1], letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function Row({ icon, label, value, tone }: { icon?: IconName; label: string; value?: string; tone?: string }) {
  return (
    <View style={s.rowItem}>
      {icon && <View style={s.rowIcon}><Icon name={icon} size={17} color={colors.maroon} /></View>}
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
      {value && <Text style={[type.body, { fontWeight: "700", color: tone ?? colors.ink }]}>{value}</Text>}
    </View>
  );
}

export const SectionTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xl, marginBottom: space.md }}>
    <Text style={type.h2}>{children}</Text>{action}
  </View>
);

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", minHeight: 60, paddingTop: 6 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow.card },
  button: { minHeight: 56, borderRadius: radius.lg, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  buttonText: { fontSize: 16, fontWeight: "800", letterSpacing: 0.2 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, height: 40, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 24, borderRadius: radius.pill, alignSelf: "flex-start" },
  rowItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  rowIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
});
