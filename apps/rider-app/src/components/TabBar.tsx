import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow } from "../theme";
import { Icon, tap, type IconName } from "./ui";

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Home", icon: "home" },
  orders: { label: "Orders", icon: "package" },
  cash: { label: "Cash", icon: "credit-card" },
  profile: { label: "Me", icon: "user" },
};

type Route = { key: string; name: string };
export type BarProps = {
  state: { index: number; routes: Route[] };
  emitter: { emit: (e: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean } };
  navigateToTab: (routeKey: string) => void;
};

/** Floating pill tab bar. The yellow highlight slides between tabs on a spring, and the active icon pops. */
export function TabBar({ state, emitter, navigateToTab }: BarProps) {
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(0);
  const tabW = w / state.routes.length;
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(state.index * tabW, { duration: 260, easing: Easing.out(Easing.cubic) }) }] }), [state.index, tabW]);

  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={s.bar} onLayout={e => setW(e.nativeEvent.layout.width - 12)}>
        <Animated.View style={[s.blob, { width: tabW }, slide]}><View style={s.blobInner} /></Animated.View>
        {state.routes.map((route, i) => {
          const meta = TABS[route.name]; if (!meta) return null;
          const focused = state.index === i;
          return (
            <Pressable key={route.key} style={s.tab} accessibilityRole="button" accessibilityLabel={meta.label} accessibilityState={{ selected: focused }}
              onPress={() => { tap(); const ev = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true }); if (!focused && !ev.defaultPrevented) navigateToTab(route.key); }}>
              <TabIcon icon={meta.icon} focused={focused} />
              <Text style={[s.label, { color: focused ? colors.maroon : colors.faint }]}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TabIcon({ icon, focused }: { icon: IconName; focused: boolean }) {
    return <Icon name={icon} size={22} color={focused ? colors.maroon : colors.faint} />;
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18 },
  bar: { flexDirection: "row", backgroundColor: colors.white, borderRadius: radius.xl, padding: 6, ...shadow.lift },
  tab: { flex: 1, height: 56, alignItems: "center", justifyContent: "center", gap: 2, zIndex: 2 },
  label: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.3 },
  blob: { position: "absolute", left: 6, top: 6, bottom: 6, zIndex: 1 },
  blobInner: { flex: 1, marginHorizontal: 4, borderRadius: radius.lg, backgroundColor: colors.yellowSoft },
});
