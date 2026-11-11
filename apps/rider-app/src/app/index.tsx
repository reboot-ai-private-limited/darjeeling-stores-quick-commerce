import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInUp, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useStore } from "../state/store";
import { colors } from "../theme";

/** Splash: the logo springs in, floats gently, and a thin loader fills before we move on. */
export default function Splash() {
  const { booting, signedIn, shift } = useStore();
  const minTime = useRef(false);
  const latest = useRef({ booting, signedIn, on: shift.on });
  latest.current = { booting, signedIn, on: shift.on };
  const pop = useSharedValue(0);
  const load = useSharedValue(0);

  useEffect(() => {
    pop.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    load.value = withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.cubic) });
    const t = setTimeout(() => { minTime.current = true; go(); }, 1700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop, load]);

  // Move on once the logo has had its moment AND we know whether the rider is already signed in.
  const go = () => { const l = latest.current; if (!minTime.current || l.booting) return; router.replace(!l.signedIn ? "/login" : l.on ? "/(tabs)" : "/start-shift"); };
  useEffect(go, [booting, signedIn, shift.on]); // eslint-disable-line react-hooks/exhaustive-deps

  const logo = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.85 + pop.value * 0.15 }] }));
  const bar = useAnimatedStyle(() => ({ width: `${load.value * 100}%` }));

  return (
    <LinearGradient colors={[colors.maroonDeep, colors.maroon, colors.maroonSoft]} style={s.fill}>
      <StatusBar style="light" />
      <View style={s.blobA} /><View style={s.blobB} />
      <Animated.View style={[s.mark, logo]}>
        <Text style={s.markText}>ds<Text style={{ color: colors.red }}>.</Text></Text>
      </Animated.View>
      <Animated.Text entering={FadeInUp.delay(500).duration(350)} style={s.name}>DARJEELING STORES</Animated.Text>
      <Animated.Text entering={FadeIn.delay(850)} style={s.tag}>Rider</Animated.Text>
      <View style={s.track}><Animated.View style={[s.barFill, bar]} /></View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
  blobA: { position: "absolute", width: 380, height: 380, borderRadius: 190, backgroundColor: "rgba(255,201,51,0.08)", top: -120, right: -140 },
  blobB: { position: "absolute", width: 300, height: 300, borderRadius: 150, backgroundColor: "rgba(255,255,255,0.05)", bottom: -100, left: -110 },
  mark: { width: 128, height: 128, borderRadius: 38, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 14 },
  markText: { fontSize: 62, fontWeight: "900", color: colors.maroon, letterSpacing: -4 },
  name: { marginTop: 30, color: colors.white, fontSize: 15, fontWeight: "800", letterSpacing: 5 },
  tag: { marginTop: 8, color: colors.yellow, fontSize: 13, fontWeight: "800", letterSpacing: 3 },
  track: { position: "absolute", bottom: 90, width: 120, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.yellow },
});
