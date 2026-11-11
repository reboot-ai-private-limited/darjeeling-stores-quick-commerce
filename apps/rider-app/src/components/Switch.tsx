import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { smooth } from "../motion";
import { colors } from "../theme";
import { tap } from "./ui";

/** A switch whose knob glides across while the track colour fades. */
export function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  // One shared 0..1 progress value drives both the colour and the knob (an animation object can't be passed to interpolateColor on a real device).
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => { progress.value = smooth(value ? 1 : 0, 200); }, [value, progress]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.value, [0, 1], [colors.creamDeep, colors.green]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * 22 }] }));
  return (
    <Pressable onPress={() => { tap(); onChange(!value); }} accessibilityRole="switch" accessibilityState={{ checked: value }} hitSlop={10}>
      <Animated.View style={[{ width: 54, height: 32, borderRadius: 16, padding: 3 }, track]}>
        <Animated.View style={[{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.white, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }, knob]} />
      </Animated.View>
    </Pressable>
  );
}
