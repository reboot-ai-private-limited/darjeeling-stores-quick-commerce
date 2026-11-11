import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, space } from "../theme";
import { Icon } from "./ui";

/** A slim bar at the top while the phone has no internet. It goes away by itself when the connection returns. */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const off = NetInfo.addEventListener(st => setOffline(st.isConnected === false || st.isInternetReachable === false));
    return () => off();
  }, []);
  if (!offline) return null;
  return (
    <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(200)} pointerEvents="none" style={[s.bar, { paddingTop: insets.top + 6 }]}>
      <Icon name="wifi-off" size={14} color={colors.white} /><Text style={s.text}>No internet connection. Showing what we last loaded.</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 100, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.red, paddingBottom: 6, paddingHorizontal: space.lg },
  text: { color: colors.white, fontSize: 12, fontWeight: "800" },
});
