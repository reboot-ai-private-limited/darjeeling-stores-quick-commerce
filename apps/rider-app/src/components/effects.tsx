import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { Easing, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../theme";

/** Counts up from 0 to `target`, easing out. Used for money and delivery counts so numbers feel alive. */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function Ring({ delay, size, color }: { delay: number; size: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false)); }, [delay, p]);
  const style = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.45, 0]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 2.6]) }] }));
  return <Animated.View style={[{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** Soft expanding rings behind an icon: the "something is calling you" effect of the assignment alarm. */
export function PulseRings({ size = 120, color = colors.yellow, children }: { size?: number; color?: string; children?: React.ReactNode }) {
  return (
    <View style={{ width: size * 2.6, height: size * 2.6, alignItems: "center", justifyContent: "center" }}>
      {[0, 800, 1600].map(d => <Ring key={d} delay={d} size={size} color={color} />)}
      {children}
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** A green circle that pops in, then draws its tick. */
export function SuccessCheck({ size = 120, color = colors.green }: { size?: number; color?: string }) {
  const pop = useSharedValue(0);
  const draw = useSharedValue(0);
  useEffect(() => {
    pop.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
    draw.value = withDelay(260, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [pop, draw]);
  const wrap = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const props = useAnimatedProps(() => ({ strokeDashoffset: 60 * (1 - draw.value) }));
  return (
    <Animated.View style={wrap}>
      <Svg width={size} height={size} viewBox="0 0 72 72">
        <Circle cx={36} cy={36} r={34} fill={color} />
        <AnimatedPath d="M21 37 L32 48 L52 26" stroke="#fff" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={60} animatedProps={props} />
      </Svg>
    </Animated.View>
  );
}

const PALETTE = [colors.yellow, colors.red, colors.green, colors.maroon, colors.blue, "#ff8a4c"];
function Piece({ i, width }: { i: number; width: number }) {
  const p = useSharedValue(0);
  // All the random-looking numbers are worked out here, on the JS side, as plain values. (Calling a helper function from inside the animation crashes on a real device.)
  const seed = (n: number) => Math.abs(Math.sin(i * 12.9898 + n * 78.233));
  const delay = seed(1) * 350, duration = 1700 + seed(2) * 900;
  const dx = (seed(3) - 0.5) * width * 0.9;
  const rise = -90 - seed(4) * 90, fall = 380 + seed(5) * 160, spin = 360 + seed(6) * 540;
  const w = 7 + seed(7) * 7;
  useEffect(() => { p.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.quad) })); }, [p, delay, duration]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.1, 0.8, 1], [0, 1, 1, 0]),
    transform: [{ translateX: dx * p.value }, { translateY: interpolate(p.value, [0, 0.35, 1], [0, rise, fall]) }, { rotate: `${p.value * spin}deg` }],
  }));
  return <Animated.View style={[{ position: "absolute", top: 0, left: width / 2, width: w, height: w * (seed(8) > 0.5 ? 1 : 2), borderRadius: 2, backgroundColor: PALETTE[i % PALETTE.length] }, style]} />;
}

/** One burst of confetti falling from the top of its container. */
export function Confetti({ width, count = 36 }: { width: number; count?: number }) {
  return <View pointerEvents="none" style={{ position: "absolute", top: 80, left: 0, right: 0, height: 1 }}>{Array.from({ length: count }, (_, i) => <Piece key={i} i={i} width={width} />)}</View>;
}
