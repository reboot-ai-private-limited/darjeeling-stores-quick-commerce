import { useEffect } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { colors, radius, space, type } from "../theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const PALETTE = [colors.yellow, colors.red, colors.green, colors.maroon, colors.blue, "#ff8a4c"];

/** A tick that pops in and then draws itself. */
function Tick({ size = 110 }: { size?: number }) {
  const pop = useSharedValue(0);
  const draw = useSharedValue(0);
  useEffect(() => {
    pop.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    draw.value = withDelay(240, withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }));
  }, [pop, draw]);
  const wrap = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const props = useAnimatedProps(() => ({ strokeDashoffset: 60 * (1 - draw.value) }));
  return (
    <Animated.View style={wrap}>
      <Svg width={size} height={size} viewBox="0 0 72 72">
        <Circle cx={36} cy={36} r={34} fill={colors.green} />
        <AnimatedPath d="M21 37 L32 48 L52 26" stroke="#fff" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={60} animatedProps={props} />
      </Svg>
    </Animated.View>
  );
}

/** One piece of confetti thrown up from the middle and falling away. The random-looking numbers are plain values worked out here, not inside the animation. */
function Piece({ i, width }: { i: number; width: number }) {
  const p = useSharedValue(0);
  const seed = (n: number) => Math.abs(Math.sin(i * 12.9898 + n * 78.233));
  const delay = 150 + seed(1) * 250, duration = 1100 + seed(2) * 600;
  const dx = (seed(3) - 0.5) * width * 0.95;
  const rise = -120 - seed(4) * 110, fall = 220 + seed(5) * 160, spin = 360 + seed(6) * 540;
  const w = 7 + seed(7) * 7;
  const h = w * (seed(8) > 0.5 ? 1 : 2);
  const color = PALETTE[i % PALETTE.length];
  useEffect(() => { p.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.quad) })); }, [p, delay, duration]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.1, 0.8, 1], [0, 1, 1, 0]),
    transform: [{ translateX: dx * p.value }, { translateY: interpolate(p.value, [0, 0.35, 1], [0, rise, fall]) }, { rotate: `${p.value * spin}deg` }],
  }));
  return <Animated.View style={[{ position: "absolute", left: width / 2, top: 0, width: w, height: h, borderRadius: 2, backgroundColor: color }, style]} />;
}

/** Full-screen "coupon applied" moment: a dimmed backdrop, a drawn tick, the code, and a burst of confetti. The caller closes it after about a second. */
export function CouponSuccess({ code, description }: { code: string; description?: string }) {
  const { width } = useWindowDimensions();
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(200)} style={s.backdrop} pointerEvents="auto">
      <View pointerEvents="none" style={{ position: "absolute", top: "42%", left: 0, right: 0, height: 1 }}>
        {Array.from({ length: 34 }, (_, i) => <Piece key={i} i={i} width={width} />)}
      </View>
      <View style={s.card}>
        <Tick />
        <Text style={[type.h2, { marginTop: space.lg, textAlign: "center" }]}>Coupon applied!</Text>
        <View style={s.pill}><Text style={s.pillText}>{code}</Text></View>
        {!!description && <Text style={[type.small, { textAlign: "center", marginTop: space.sm }]}>{description}</Text>}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(35,24,21,0.55)", alignItems: "center", justifyContent: "center", zIndex: 50 },
  card: { width: "78%", backgroundColor: colors.white, borderRadius: radius.xl, alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg },
  pill: { marginTop: space.sm, borderWidth: 1.5, borderColor: colors.maroon, borderStyle: "dashed", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 3, backgroundColor: colors.yellowSoft },
  pillText: { color: colors.maroon, fontWeight: "900", letterSpacing: 1.4, fontSize: 15 },
});
