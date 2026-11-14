import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CartBar, GlassScene } from "../../components/shop";
import { TabBar, TAB_BAR_GAP, TAB_BAR_H, type BarProps } from "../../components/TabBar";
import { colors } from "../../theme";

/** Floating pill tabs (same as the rider app): Home, Categories, Orders, Account. The cart bar floats just above them. */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const barTop = TAB_BAR_H + insets.bottom + TAB_BAR_GAP;
  return (
    <GlassScene style={{ backgroundColor: colors.cream }} bar={<CartBar bottom={barTop - insets.bottom - 4} />}>
      <Tabs
        tabBar={props => <TabBar {...(props as unknown as BarProps)} />}
        screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: colors.cream } }}
      >
        <Tabs.Screen name="home" />
        <Tabs.Screen name="categories" />
        <Tabs.Screen name="orders" />
        <Tabs.Screen name="account" />
      </Tabs>
    </GlassScene>
  );
}
