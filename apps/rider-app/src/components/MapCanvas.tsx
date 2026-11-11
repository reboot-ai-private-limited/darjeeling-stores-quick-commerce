import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, { Easing, interpolate, useAnimatedProps, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, G, Path, Polyline, Rect } from "react-native-svg";
import { colors } from "../theme";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const ROUTE: [number, number][] = [[46, 176], [120, 168], [138, 112], [208, 102], [236, 58], [296, 44]];
const length = ROUTE.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - ROUTE[i]![0], y - ROUTE[i]![1]), 0);
const idx = ROUTE.map((_, i) => i / (ROUTE.length - 1));
const xs = ROUTE.map(p => p[0]);
const ys = ROUTE.map(p => p[1]);

/**
 * A stylised map: blocks, roads, a route that draws itself and a rider dot that travels along it.
 * It is a drawing, not real map tiles; "Open in Google Maps" does the actual navigation.
 */
export function MapCanvas({ height = 260, moving = true }: { height?: number; moving?: boolean }) {
  const draw = useSharedValue(0);
  const travel = useSharedValue(0);
  useEffect(() => {
    draw.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
    if (moving) travel.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [draw, travel, moving]);
  const route = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - draw.value) }));
  const dot = useAnimatedProps(() => ({ cx: interpolate(travel.value, idx, xs), cy: interpolate(travel.value, idx, ys) }));
  const halo = useAnimatedProps(() => ({ cx: interpolate(travel.value, idx, xs), cy: interpolate(travel.value, idx, ys), r: 11 + 5 * Math.sin(travel.value * 40) }));
  const points = useMemo(() => ROUTE.map(p => p.join(",")).join(" "), []);

  return (
    <View style={{ height, borderRadius: 26, overflow: "hidden", backgroundColor: "#efe9da" }}>
      <Svg width="100%" height="100%" viewBox="0 0 340 220" preserveAspectRatio="xMidYMid slice">
        <Rect width={340} height={220} fill="#efe9da" />
        {[[10, 10, 70, 60], [96, 14, 60, 50], [180, 8, 40, 66], [250, 70, 80, 50], [14, 96, 80, 50], [160, 126, 70, 54], [252, 140, 76, 60], [20, 180, 60, 34]].map(([x, y, w, h], i) => (
          <Rect key={i} x={x} y={y} width={w} height={h} rx={9} fill={i % 3 === 0 ? "#e2ecd2" : "#e8e1cf"} />
        ))}
        <Path d="M0 130 C80 120 140 150 340 120 M100 0 C110 80 90 140 120 220 M230 0 C225 70 250 120 240 220" stroke="#fffdf6" strokeWidth={9} fill="none" strokeLinecap="round" />
        <Polyline points={points} stroke={colors.maroon} strokeOpacity={0.14} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" fill="none" />
        <AnimatedPolyline points={points} stroke={colors.maroon} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" fill="none" strokeDasharray={length} animatedProps={route} />
        <G>
          <Circle cx={ROUTE[0]![0]} cy={ROUTE[0]![1]} r={9} fill={colors.white} stroke={colors.maroon} strokeWidth={4} />
          <Circle cx={ROUTE[5]![0]} cy={ROUTE[5]![1]} r={13} fill={colors.red} />
          <Circle cx={ROUTE[5]![0]} cy={ROUTE[5]![1]} r={5} fill={colors.white} />
        </G>
        <AnimatedCircle animatedProps={halo} fill={colors.yellow} fillOpacity={0.35} />
        <AnimatedCircle animatedProps={dot} r={7} fill={colors.yellow} stroke={colors.maroon} strokeWidth={3} />
      </Svg>
    </View>
  );
}
