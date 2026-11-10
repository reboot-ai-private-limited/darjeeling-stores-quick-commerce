import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Button, Header, Icon, Screen, Stagger } from "../components/ui";
import { useStore } from "../state/store";
import { colors, type } from "../theme";

/** Shows how many finished steps the server is still waiting for, straight from the rider's profile. */
export default function Sync() {
  const { me, refresh } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = me?.pendingSyncCount ?? 0;
  const spin = useSharedValue(0);
  useEffect(() => { spin.value = busy ? withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1) : withTiming(0, { duration: 200 }); }, [busy, spin]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const clear = pending === 0;

  async function check() {
    setBusy(true); setError("");
    try { await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the server."); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <Header title="Sync status" />
      <Stagger i={0} style={{ alignItems: "center", marginTop: 40 }}>
        <View style={[s.circle, { backgroundColor: clear ? colors.greenSoft : colors.blueSoft }]}>
          <Animated.View style={style}><Icon name={clear ? "check-circle" : "refresh-cw"} size={48} color={clear ? colors.green : colors.blue} /></Animated.View>
        </View>
        <Text style={[type.title, { marginTop: 22 }]}>{clear ? "All caught up" : `${pending} waiting to upload`}</Text>
        <Text style={[type.small, { marginTop: 6, textAlign: "center", paddingHorizontal: 30 }]}>{clear ? "Everything you've done is saved on the server." : "These steps are not on the server yet. Make sure you have signal, then check again."}</Text>
      </Stagger>
      {error ? <Text style={{ color: colors.red, fontWeight: "700", textAlign: "center", marginTop: 20 }}>{error}</Text> : null}
      <View style={{ marginTop: 30 }}><Button label={busy ? "Checking…" : "Check now"} icon="refresh-cw" variant="soft" disabled={busy} onPress={() => void check()} /></View>
    </Screen>
  );
}

const s = StyleSheet.create({ circle: { width: 124, height: 124, borderRadius: 42, alignItems: "center", justifyContent: "center" } });
