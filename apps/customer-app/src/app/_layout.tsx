import { router, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OfflineBanner } from "../components/OfflineBanner";
import { CartProvider } from "../state/cart";
import { listenForPush, registerPush, type PushData } from "../push";
import { StoreProvider, useStore } from "../state/store";
import { colors } from "../theme";

/** Sends the customer to the "update needed" / "maintenance" screen whenever the server asks for it. */
function BlockedGate() {
  const { blocked } = useStore();
  const pathname = usePathname();
  useEffect(() => { if (blocked && pathname !== "/blocked") router.replace("/blocked"); }, [blocked, pathname]);
  return null;
}

/** Opens the screen a `ds://section/optional-id` link names. Returns false when the link isn't one the app knows, so the caller can fall back. */
function openDeepLink(link: string): boolean {
  const m = /^ds:\/\/([a-z]+)(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(link.trim());
  if (!m) return false;
  const [, section, id] = m;
  if (id) {
    switch (section) {
      case "product": router.push({ pathname: "/product/[id]", params: { id } }); return true;
      case "category": router.push({ pathname: "/category/[id]", params: { id } }); return true;
      case "brand": router.push({ pathname: "/brand/[id]", params: { id } }); return true;
      case "order": router.push({ pathname: "/order/[id]", params: { id } }); return true;
      default: return false;
    }
  }
  switch (section) {
    case "home": router.push("/(tabs)/home"); return true;
    case "categories": router.push("/(tabs)/categories"); return true;
    case "orders": router.push("/(tabs)/orders"); return true;
    case "account": router.push("/(tabs)/account"); return true;
    case "cart": router.push("/cart"); return true;
    case "search": router.push("/search"); return true;
    case "refunds": router.push("/refunds"); return true;
    default: return false;
  }
}

/** Once signed in: tells the server this phone's notification address, and opens the right screen when a notification is tapped. */
function PushGate() {
  const { signedIn, booting } = useStore();
  useEffect(() => {
    if (booting || !signedIn) return;
    void registerPush();
    return listenForPush((data: PushData) => {
      const group = typeof data.groupId === "string" ? data.groupId : null;
      // Promo and back-in-stock notifications carry a link such as ds://product/<id> or ds://category/<id>.
      if (typeof data.deepLink === "string" && openDeepLink(data.deepLink)) return;
      if (data.type === "refund") router.push("/refunds");
      else if (group) router.push({ pathname: "/order/[id]", params: { id: group } });
      else router.push("/(tabs)/orders");
    });
  }, [booting, signedIn]);
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.cream }}>
      <SafeAreaProvider>
        <StoreProvider><CartProvider>
          <StatusBar style="dark" />
          <BlockedGate />
          <PushGate />
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
            <Stack.Screen name="product/[id]" options={{ animation: "slide_from_right", animationDuration: 300 }} />
          </Stack>
        </CartProvider></StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
