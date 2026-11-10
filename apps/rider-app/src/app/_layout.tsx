import { router, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
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
 * Every screen change animates. Forward steps slide in from the right, the alarm and sheets rise from the bottom,
 * and "arrival" moments (splash, delivered) cross-fade so they feel like a scene change, not a page load.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.cream }}>
      <SafeAreaProvider>
        <StoreProvider>
          <StatusBar style="dark" />
          <BlockedGate />
          <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", animationDuration: 320, contentStyle: { backgroundColor: colors.cream } }}>
            <Stack.Screen name="index" options={{ animation: "fade" }} />
            <Stack.Screen name="login" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="blocked" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" options={{ animation: "fade", animationDuration: 420, gestureEnabled: false }} />
            <Stack.Screen name="alarm" options={{ presentation: "fullScreenModal", animation: "fade_from_bottom", animationDuration: 420, gestureEnabled: false }} />
            <Stack.Screen name="order/delivered" options={{ animation: "fade", animationDuration: 450, gestureEnabled: false }} />
            <Stack.Screen name="problem" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          </Stack>
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
