import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from "react-native-reanimated";
import { ApiError } from "../api/http";
import type { RiderWarehouse } from "../api/rider";
import { SwipeButton } from "../components/SwipeButton";
import { Icon, Pill, Press, Screen, Stagger } from "../components/ui";
import { smooth } from "../motion";
import { useStore } from "../state/store";
import { colors, radius, shadow, type } from "../theme";

const RADIUS_M = 150; // the server's default punch-in radius; punching in from further away is allowed but flagged

type Fix = { lat: number; lng: number; accuracy: number | null };
const toRad = (d: number) => (d * Math.PI) / 180;
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
};

function Option({ w, fix, selected, onPress }: { w: RiderWarehouse; fix: Fix | null; selected: boolean; onPress: () => void }) {
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: smooth(selected ? 1 : 0, 180) }] }), [selected]);
  const d = fix ? metres(fix, w.location) : null;
  const near = d !== null && d <= RADIUS_M;
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  return (
    <Press onPress={onPress} haptic style={[s.card, selected && { borderColor: colors.maroon, backgroundColor: colors.white }]}>
      <View style={s.pin}><Icon name="home" size={22} color={colors.maroon} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "800" }]}>{w.name}</Text>
        <View style={{ marginTop: 8 }}>
          {d === null ? <Pill label="Finding your location…" tone="maroon" icon="map-pin" />
            : <Pill label={near ? `${km(d)} away · in range` : `${km(d)} away · outside range`} tone={near ? "green" : "amber"} icon={near ? "check" : "alert-triangle"} />}
        </View>
      </View>
      <View style={s.radio}><Animated.View style={[s.radioDot, dot]} /></View>
    </Press>
  );
}

export default function StartShift() {
  const { warehouses, startShift, refresh, me } = useStore();
  const [picked, setPicked] = useState<RiderWarehouse | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locStatus, setLocStatus] = useState<"checking" | "ok" | "denied" | "error">("checking");
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);

  const locate = useCallback(async () => {
    setLocStatus("checking"); setError("");
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { setLocStatus("denied"); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null });
      setLocStatus("ok");
    } catch { setLocStatus("error"); }
  }, []);
  useEffect(() => { void locate(); }, [locate]);
  useEffect(() => { if (!picked && warehouses.length === 1) setPicked(warehouses[0]!); }, [warehouses, picked]);

  const outside = picked && fix ? metres(fix, picked.location) > RADIUS_M : false;

  async function punchIn() {
    if (!picked) return;
    if (!fix) { setError("We need your location to punch in. Turn on location and try again."); setResetKey(k => k + 1); return; }
    setError("");
    try {
      await startShift(picked.id, { lat: fix.lat, lng: fix.lng }, fix.accuracy);
      router.replace("/(tabs)");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { await refresh().catch(() => undefined); router.replace("/(tabs)"); return; } // a shift is already open
      setError(e instanceof Error ? e.message : "Could not start your shift. Please try again.");
      setResetKey(k => k + 1);
    }
  }

  return (
    <Screen>
      <Stagger i={0} style={{ marginTop: 28 }}>
        <Text style={type.label}>Step 2 of 2</Text>
        <Text style={[type.title, { marginTop: 6 }]}>Start your shift</Text>
        <Text style={[type.small, { marginTop: 8 }]}>{me ? `Hi ${me.name.split(" ")[0]}. ` : ""}Pick the store you're working from. You'll punch in with your location.</Text>
      </Stagger>

      {locStatus === "denied" || locStatus === "error" ? (
        <Animated.View entering={FadeIn} style={s.warn}>
          <Icon name="map-pin" size={18} color={colors.amber} />
          <Text style={[type.small, { flex: 1, color: colors.amber, fontWeight: "700" }]}>{locStatus === "denied" ? "Location permission is off. Allow it in your phone settings to punch in." : "Couldn't find your location. Check that location is on."}</Text>
          <Press onPress={() => void locate()} haptic><Text style={{ color: colors.maroon, fontWeight: "800" }}>Retry</Text></Press>
        </Animated.View>
      ) : null}

      <View style={{ gap: 14, marginTop: 24 }}>
        {warehouses.length === 0 && <Text style={type.small}>No stores are assigned to you yet. Ask your manager to add one.</Text>}
        {warehouses.map((w, i) => <Stagger key={w.id} i={i + 1}><Option w={w} fix={fix} selected={picked?.id === w.id} onPress={() => setPicked(w)} /></Stagger>)}
      </View>

      {outside && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={s.warn}>
          <Icon name="alert-triangle" size={18} color={colors.amber} />
          <Text style={[type.small, { flex: 1, color: colors.amber, fontWeight: "700" }]}>You're outside the {RADIUS_M} m punch-in range. You can still start, but your manager will be told.</Text>
        </Animated.View>
      )}
      {error ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 14 }}>{error}</Text> : null}

      <View style={{ flex: 1 }} />
      <Stagger i={4}>
        <SwipeButton label={picked ? "Slide to punch in" : "Pick a store first"} icon="log-in" tone="green" disabled={!picked || locStatus === "checking"} resetKey={resetKey} onConfirm={() => void punchIn()} />
      </Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.lg, backgroundColor: colors.creamDeep, borderWidth: 2, borderColor: "transparent", ...shadow.card },
  pin: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.maroon, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.maroon },
  warn: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: 14, marginTop: 16 },
});
