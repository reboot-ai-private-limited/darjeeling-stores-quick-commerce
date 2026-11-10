import { Redirect, router, Tabs, usePathname } from "expo-router";
import { useEffect } from "react";
import { TabBar, type BarProps } from "../../components/TabBar";
import { useStore } from "../../state/store";

export default function TabsLayout() {
  const { signedIn, shift, ringing } = useStore();
  const pathname = usePathname();

  // A new assignment arrived and has not been accepted: open the alarm over whatever the rider is doing.
  const ringingId = ringing?.id;
  useEffect(() => {
    if (ringingId && !shift.onBreak && pathname !== "/alarm") router.push("/alarm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringingId]);

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
