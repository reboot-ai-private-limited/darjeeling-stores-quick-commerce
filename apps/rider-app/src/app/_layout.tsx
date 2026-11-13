import { router, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../tracking";
import { listenForPush, registerPush } from "../push";
import { StoreProvider, useStore } from "../state/store";
import { colors } from "../theme";

/** Sends the rider to the "update needed" / "maintenance" screen whenever the server asks for it. */
function BlockedGate() {
  const { blocked } = useStore();
  const pathname = usePathname();
  useEffect(() => { if (blocked && pathname !== "/blocked") router.replace("/blocked"); }, [blocked, pathname]);
  return null;
}

/**
 * Once signed in: tells the server this phone's notification address, and reacts to pushes. A new-delivery push refreshes the orders
 * straight away, so the "new delivery" banner shows on Home. There is no full-screen alarm: the phone rings through the notification.
 */
function PushGate() {
  const { signedIn, booting, refreshOrders } = useStore();
  useEffect(() => {
    if (booting || !signedIn) return;
    void registerPush();
    return listenForPush(
      () => { void refreshOrders(); },
      () => { void refreshOrders().then(() => router.replace("/new-delivery")).catch(() => router.replace("/(tabs)")); },
    );
  }, [booting, signedIn, refreshOrders]);
  return null;
}

/**
 * Every screen change animates. Forward steps slide in from the right, sheets rise from the bottom,
 * and "arrival" moments (splash, delivered) cross-fade so they feel like a scene change, not a page load.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.cream }}>
      <SafeAreaProvider>
        <StoreProvider>
          <StatusBar style="dark" />
          <BlockedGate />
          <PushGate />
          <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", animationDuration: 320, contentStyle: { backgroundColor: colors.cream } }}>
            <Stack.Screen name="index" options={{ animation: "fade" }} />
            <Stack.Screen name="login" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="blocked" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" options={{ animation: "fade", animationDuration: 420, gestureEnabled: false }} />
            <Stack.Screen name="new-delivery" />
            <Stack.Screen name="order/delivered" options={{ animation: "fade", animationDuration: 450, gestureEnabled: false }} />
            <Stack.Screen name="problem" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          </Stack>
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
