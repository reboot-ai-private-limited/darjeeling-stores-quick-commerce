import { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, radius, shadow } from "../theme";
import { Icon, tap, type IconName } from "./ui";

const KNOB = 56;
const PAD = 5;

/**
 * "Slide to confirm" control. Used for the actions that matter (pick up, arrived, delivered) so they can't be hit by accident.
 * The knob follows the finger, the label fades as it travels, and the track fills with colour.
 */
export function SwipeButton({ label, onConfirm, icon = "chevrons-right", tone = "maroon", disabled = false, resetKey = 0 }: { label: string; onConfirm: () => void; icon?: IconName; tone?: "maroon" | "green" | "red"; disabled?: boolean; resetKey?: number }) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const done = useSharedValue(0);
  const max = Math.max(1, width - KNOB - PAD * 2);
  const maxRef = useRef(max); maxRef.current = max;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const base = { maroon: colors.maroon, green: colors.green, red: colors.red }[tone];

  // When an action fails, the screen bumps resetKey so the knob slides back and the rider can try again.
  useEffect(() => { if (resetKey) { x.value = withTiming(0, { duration: 220 }); done.value = 0; } }, [resetKey, x, done]);

  // The gesture handler below is created once, so it must read the latest onConfirm from a ref (otherwise it would run the one from the first render).
  const confirmRef = useRef(onConfirm); confirmRef.current = onConfirm;
  const finish = () => { tap("success"); confirmRef.current(); };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current,
    onPanResponderGrant: () => tap(),
    onPanResponderMove: (_e, g) => { x.value = Math.min(maxRef.current, Math.max(0, g.dx)); },
    onPanResponderRelease: (_e, g) => {
      if (g.dx > maxRef.current * 0.78) {
        x.value = withTiming(maxRef.current, { duration: 120 }, (ok) => { if (ok) { done.value = 1; runOnJS(finish)(); } });
      } else {
        x.value = withTiming(0, { duration: 200 });
      }
    },
    onPanResponderTerminate: () => { x.value = withTiming(0, { duration: 200 }); },
  })).current;

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { scale: interpolate(done.value, [0, 1], [1, 0.9]) }] }));
  const fill = useAnimatedStyle(() => ({ width: x.value + KNOB + PAD * 2 }));
  const text = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, max * 0.55], [1, 0], "clamp"), transform: [{ translateX: interpolate(x.value, [0, max], [0, 24], "clamp") }] }));

  return (
    <View style={[s.track, { opacity: disabled ? 0.45 : 1 }, shadow.card]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}>
      <Animated.View style={[s.fill, { backgroundColor: base }, fill]} />
      <Animated.View style={[s.labelWrap, text]} pointerEvents="none"><Text style={[s.label, { color: base }]}>{label}</Text></Animated.View>
      <Animated.View style={[s.knob, { backgroundColor: base }, knob]}><Icon name={icon} color={colors.white} size={24} /></Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  track: { height: KNOB + PAD * 2, borderRadius: radius.pill, backgroundColor: colors.white, justifyContent: "center", overflow: "hidden" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: radius.pill, opacity: 0.18 },
  labelWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingLeft: KNOB },
  label: { fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  knob: { position: "absolute", left: PAD, width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: "center", justifyContent: "center" },
});
