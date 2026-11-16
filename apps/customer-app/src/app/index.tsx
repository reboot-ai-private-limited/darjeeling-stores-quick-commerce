import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { Image, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useStore } from "../state/store";
import { colors } from "../theme";

/** Splash: the logo eases in and a thin loader fills while we check the session, saved place and server status. */
export default function Splash() {
  const { booting, welcomed, zone } = useStore();
  const minTime = useRef(false);
  const latest = useRef({ booting, welcomed, zone: !!zone });
  latest.current = { booting, welcomed, zone: !!zone };
  const pop = useSharedValue(0);
  const load = useSharedValue(0);

  const go = () => {
    const l = latest.current;
    if (!minTime.current || l.booting) return;
    router.replace(!l.welcomed ? "/welcome" : l.zone ? "/home" : "/location");
  };

  useEffect(() => {
    pop.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    load.value = withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.cubic) });
    const t = setTimeout(() => { minTime.current = true; go(); }, 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop, load]);
  useEffect(go, [booting, welcomed]); // eslint-disable-line react-hooks/exhaustive-deps

  const logo = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.85 + pop.value * 0.15 }] }));
  const bar = useAnimatedStyle(() => ({ width: `${load.value * 100}%` }));

  // The same glassy gradient as the app's home header: ivory top-left fading through light green, with a soft green glow and a white sheen.
  return (
    <LinearGradient colors={["#F6FBF4", "#DDEFD8", "#C3E2C5"]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fill}>
      <StatusBar style="dark" />
      <LinearGradient pointerEvents="none" colors={["rgba(62,127,83,0)", "rgba(62,127,83,0.22)"]} start={{ x: 0.35, y: 0.3 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,0.75)", "rgba(255,255,255,0)"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.sheen} />
      <View style={s.blobA} /><View style={s.blobB} />
      <Animated.View style={[s.mark, logo]}>
        <Image source={require("../../assets/logo.png")} style={s.logoImg} />
      </Animated.View>
      <View style={s.track}><Animated.View style={[s.barFill, bar]} /></View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
  blobA: { position: "absolute", width: 380, height: 380, borderRadius: 190, backgroundColor: "rgba(207,178,100,0.16)", top: -120, right: -140 },
  blobB: { position: "absolute", width: 300, height: 300, borderRadius: 150, backgroundColor: "rgba(255,255,255,0.45)", bottom: -100, left: -110 },
  mark: { width: 128, height: 128, borderRadius: 38, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", elevation: 14 },
  logoImg: { width: 128, height: 128, borderRadius: 38 },
  track: { position: "absolute", bottom: 90, width: 120, height: 4, borderRadius: 2, backgroundColor: "rgba(15,91,67,0.14)", overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.green },
  sheen: { position: "absolute", top: 0, left: 0, right: 0, height: 220 },
});
