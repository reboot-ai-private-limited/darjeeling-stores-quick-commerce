import { router, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OfflineBanner } from "../components/OfflineBanner";
import { CartProvider } from "../state/cart";
import { StoreProvider, useStore } from "../state/store";
import { colors } from "../theme";

/** Sends the customer to the "update needed" / "maintenance" screen whenever the server asks for it. */
function BlockedGate() {
  const { blocked } = useStore();
  const pathname = usePathname();
  useEffect(() => { if (blocked && pathname !== "/blocked") router.replace("/blocked"); }, [blocked, pathname]);
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.cream }}>
      <SafeAreaProvider>
        <StoreProvider><CartProvider>
          <StatusBar style="dark" />
          <BlockedGate />
          <OfflineBanner />
          <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", animationDuration: 320, contentStyle: { backgroundColor: colors.cream } }}>
            <Stack.Screen name="index" options={{ animation: "fade" }} />
            <Stack.Screen name="welcome" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="blocked" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="location" />
            <Stack.Screen name="outside" />
            <Stack.Screen name="login" />
            <Stack.Screen name="otp" />
            <Stack.Screen name="name" options={{ gestureEnabled: false }} />
            <Stack.Screen name="cart" options={{ animation: "slide_from_bottom", animationDuration: 300 }} />
            <Stack.Screen name="checkout" />
            <Stack.Screen name="order/[id]" />
            <Stack.Screen name="tracking/[id]" />
            <Stack.Screen name="order-placed" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="addresses" />
            <Stack.Screen name="address/edit" />
            <Stack.Screen name="pay/[id]" options={{ gestureEnabled: false }} />
            <Stack.Screen name="closed" />
            <Stack.Screen name="favourites" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="brand/[id]" />
            <Stack.Screen name="edit-profile" />
            <Stack.Screen name="notification-prefs" />
            <Stack.Screen name="refunds" />
            <Stack.Screen name="notify-me" />
            <Stack.Screen name="help" />
            <Stack.Screen name="coupons" />
            <Stack.Screen name="order/cancel" />
            <Stack.Screen name="order/refund-request" />
            <Stack.Screen name="search" options={{ animation: "fade" }} />
            <Stack.Screen name="category/[id]" />
            <Stack.Screen name="product/[id]" options={{ presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
          </Stack>
        </CartProvider></StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
