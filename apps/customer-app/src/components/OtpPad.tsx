import { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { colors, radius, shadow } from "../theme";
import { Icon, Press, tap } from "./ui";

function Box({ char, active, error, compact }: { char: string; active: boolean; error: boolean; compact: boolean }) {
  return (
    <View style={[s.box, compact && { width: 46, height: 62 }, active && { borderColor: colors.maroon }, error && { borderColor: colors.red, backgroundColor: colors.redSoft }, char ? { backgroundColor: colors.white } : null]}>
      <Text style={[s.boxText, compact && { fontSize: 26 }]}>{char}</Text>
      {active && !char && <View style={s.caret} />}
    </View>
  );
}

/** Row of code boxes. `errorKey` changes every time a wrong code is entered, which shakes the row. */
export function OtpBoxes({ value, length, errorKey = 0 }: { value: string; length: number; errorKey?: number }) {
  const x = useSharedValue(0);
  useEffect(() => { if (errorKey) x.value = withSequence(withTiming(-12, { duration: 55 }), withTiming(12, { duration: 55 }), withTiming(-9, { duration: 55 }), withTiming(9, { duration: 55 }), withTiming(0, { duration: 55 })); }, [errorKey, x]);
  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View style={[{ flexDirection: "row", gap: length > 4 ? 8 : 12, justifyContent: "center" }, shake]}>
      {Array.from({ length }, (_, i) => <Box key={i} char={value[i] ?? ""} active={i === value.length} error={errorKey > 0 && value.length === length} compact={length > 4} />)}
    </Animated.View>
  );
}

const ROWS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "⌫"]];

/** A big, glove-friendly number pad on a fixed 3-column grid. Also accepts a physical keyboard (useful on web). */
export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) onKey(e.key);
      else if (e.key === "Backspace") onKey("⌫");
    };
    window.addEventListener("keydown", onDown);
    return () => window.removeEventListener("keydown", onDown);
  }, [onKey]);

  return (
    <View style={s.pad}>
      {ROWS.map((row, r) => (
        <View key={r} style={s.padRow}>
          {row.map((k, c) => k === "" ? <View key={c} style={s.cell} /> : (
            <View key={c} style={s.cell}>
              <Press haptic onPress={() => { tap(); onKey(k); }} style={s.keyFace} scaleTo={0.9}>
                {k === "⌫" ? <Icon name="delete" size={26} /> : <Text style={s.keyText}>{k}</Text>}
              </Press>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: 64, height: 76, borderRadius: radius.md, backgroundColor: colors.creamDeep, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center", ...shadow.card },
  boxText: { fontSize: 34, fontWeight: "800", color: colors.ink },
  caret: { position: "absolute", width: 2, height: 30, backgroundColor: colors.maroon, opacity: 0.6 },
  pad: { width: "100%", maxWidth: 360, alignSelf: "center", gap: 12 },
  padRow: { flexDirection: "row", gap: 12 },
  cell: { flex: 1, height: 62 },
  keyFace: { height: 62, alignItems: "center", justifyContent: "center", backgroundColor: colors.white, borderRadius: radius.lg, ...shadow.card },
  keyText: { fontSize: 26, fontWeight: "700", color: colors.ink },
});
