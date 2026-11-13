import { Redirect, Tabs } from "expo-router";
import { TabBar, type BarProps } from "../../components/TabBar";
import { useStore } from "../../state/store";

export default function TabsLayout() {
  // A new assignment no longer takes over the screen: the phone rings through the notification, and Home shows a "New delivery waiting" banner.
  const { signedIn, shift } = useStore();

  if (!signedIn) return <Redirect href="/login" />;
  if (!shift.on) return <Redirect href="/start-shift" />;
  return (
    <Tabs
      tabBar={props => <TabBar {...(props as unknown as BarProps)} />}
      screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: "#f7f3ea" } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="orders" />
      <Tabs.Screen name="cash" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
