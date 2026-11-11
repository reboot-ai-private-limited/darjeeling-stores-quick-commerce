import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCities, getLocalities, type Locality } from "../api/app";
import { ApiError } from "../api/http";
import { MapPicker, type Point } from "../components/MapPicker";
import { Button, Card, Header, Icon, Press, Screen } from "../components/ui";
import { useStore } from "../state/store";
import { colors, radius, shadow, space, type } from "../theme";

const DARJEELING: Point = { lat: 27.041, lng: 88.2663 };
const isWeb = Platform.OS === "web";

/** Reads a friendly address line for a point; falls back to a generic label when the phone can't look it up. */
async function labelFor(p: Point): Promise<string> {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng });
    const parts = [a?.name, a?.street, a?.district ?? a?.subregion ?? a?.city].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
    if (parts.length) return parts.slice(0, 2).join(", ");
  } catch { /* geocoder unavailable */ }
  return "Pinned location";
}

/** Choose where to deliver: drag the map pin, use the phone's location, or pick an area from the list. */
export default function ChooseLocation() {
  const { place, setPlace } = useStore();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState<Point>(place ?? DARJEELING);
  const [target, setTarget] = useState<Point | null>(null);
  const [label, setLabel] = useState(place?.label ?? "");
  const [mode, setMode] = useState<"map" | "list">(isWeb ? "list" : "map");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Name the pin after the map stops moving (only the latest lookup counts).
  useEffect(() => {
    if (mode !== "map") return;
    const mine = ++seq.current;
    const t = setTimeout(async () => { const l = await labelFor(pin); if (mine === seq.current) setLabel(l); }, 350);
    return () => clearTimeout(t);
  }, [pin, mode]);

  const confirm = useCallback(async (p: Point, name: string) => {
    setBusy(true); setError(null);
    try {
      const r = await setPlace({ label: name, lat: p.lat, lng: p.lng });
      if (r.deliverable) router.replace("/home");
      else router.push({ pathname: "/outside", params: { lat: String(p.lat), lng: String(p.lng), label: name, paused: r.paused ? "1" : "" } });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  }, [setPlace]);

  const useCurrent = async () => {
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { setError("Location is off for this app. Move the pin on the map or choose your area instead."); return; }
      setBusy(true);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPin(p); setTarget(p); setBusy(false);
    } catch { setBusy(false); setError("Couldn't get your location. Move the pin on the map or choose your area instead."); }
  };

  if (mode === "list") return <AreaList onPick={(l) => void confirm(l.location, l.name)} busy={busy} error={error} onMap={isWeb ? undefined : () => setMode("map")} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <MapPicker initial={pin} target={target} onChange={setPin} />
      <View style={[s.top, { paddingTop: insets.top }]}><Header title="Delivery location" back={router.canGoBack()} /></View>
      <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <Text style={type.label}>Deliver to</Text>
        <View style={s.addr}>
          <Icon name="map-pin" color={colors.maroon} />
          <Text style={[type.h2, { flex: 1 }]} numberOfLines={2}>{label || "Move the map to place the pin"}</Text>
        </View>
        {error && <Text style={[type.small, { color: colors.red }]}>{error}</Text>}
        <Button label="Confirm location" disabled={busy} onPress={() => void confirm(pin, label || "Pinned location")} />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Use my location" variant="soft" icon="crosshair" disabled={busy} onPress={() => void useCurrent()} style={{ flex: 1 }} />
          <Button label="Pick area" variant="soft" icon="list" onPress={() => setMode("list")} style={{ flex: 1 }} />
        </View>
        {busy && <ActivityIndicator color={colors.maroon} style={StyleSheet.absoluteFill} />}
      </View>
    </View>
  );
}

/** Manual choice: the areas we know in each city. Works everywhere, including the web preview. */
function AreaList({ onPick, busy, error, onMap }: { onPick: (l: Locality) => void; busy: boolean; error: string | null; onMap?: () => void }) {
  const [areas, setAreas] = useState<Locality[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(async () => {
    setFailed(null); setAreas(null);
    try {
      const cities = await getCities();
      const lists = await Promise.all(cities.map(c => getLocalities(c.id)));
      setAreas(lists.flat());
    } catch (e) { setFailed(e instanceof ApiError ? e.message : "Couldn't load areas."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <Screen scroll>
      <Header title="Choose your area" back={router.canGoBack()} right={onMap ? <Press onPress={onMap} haptic style={s.mapBtn}><Icon name="map" size={18} color={colors.maroon} /></Press> : undefined} />
      {(error || failed) && <Text style={[type.small, { color: colors.red, marginBottom: space.sm }]}>{error ?? failed}</Text>}
      {failed && <Button label="Try again" variant="soft" onPress={() => void load()} />}
      {!areas && !failed && <ActivityIndicator color={colors.maroon} style={{ marginTop: space.xxl }} />}
      {areas?.length === 0 && <Text style={[type.body, { color: colors.muted, textAlign: "center", marginTop: space.xl }]}>We haven't opened any areas yet.</Text>}
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        {areas?.map(a => (
          <Press key={a.id} onPress={() => !busy && onPick(a)} haptic>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Icon name="map-pin" color={colors.maroon} />
              <Text style={[type.body, { flex: 1, fontWeight: "700" }]}>{a.name}</Text>
              {a.travelMinutes ? <Text style={type.small}>~{a.travelMinutes} min</Text> : null}
              <Icon name="chevron-right" color={colors.faint} />
            </Card>
          </Press>
        ))}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: space.lg },
  sheet: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md, ...shadow.lift },
  addr: { flexDirection: "row", alignItems: "center", gap: space.md },
  mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow.card },
});
