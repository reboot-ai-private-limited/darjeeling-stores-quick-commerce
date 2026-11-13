import { Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CartBar } from "../../components/shop";
import { TabBar, TAB_BAR_GAP, TAB_BAR_H, type BarProps } from "../../components/TabBar";
import { colors } from "../../theme";

/** Floating pill tabs (same as the rider app): Home, Categories, Orders, Account. The cart bar floats just above them. */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const barTop = TAB_BAR_H + insets.bottom + TAB_BAR_GAP;
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Tabs
        tabBar={props => <TabBar {...(props as unknown as BarProps)} />}
        screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: colors.cream } }}
      >
        <Tabs.Screen name="home" />
        <Tabs.Screen name="categories" />
        <Tabs.Screen name="orders" />
        <Tabs.Screen name="account" />
      </Tabs>
      {/* CartBar adds the safe-area inset and a 12px gap itself, so remove the inset here and leave a small gap above the pill */}
      <CartBar bottom={barTop - insets.bottom - 4} />
    </View>
  );
}
