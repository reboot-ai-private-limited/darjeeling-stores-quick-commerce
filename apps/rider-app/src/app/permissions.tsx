import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Switch } from "../components/Switch";
import { Button, Card, Icon, Screen, Stagger, type IconName } from "../components/ui";
import { colors, space, type } from "../theme";

const LATER: { icon: IconName; title: string; why: string }[] = [
  { icon: "bell", title: "Notifications", why: "New deliveries reaching you when the app is closed." },
  { icon: "volume-2", title: "Full-screen alarm", why: "Ringing over the lock screen." },
  { icon: "battery-charging", title: "Keep running in background", why: "Keeping the app awake during a shift." },
];

export default function Permissions() {
  const [granted, setGranted] = useState(false);
  const [denied, setDenied] = useState(false);

  const check = useCallback(async () => { try { setGranted((await Location.getForegroundPermissionsAsync()).status === "granted"); } catch { /* unavailable */ } }, []);
  useEffect(() => { void check(); }, [check]);

  async function ask(on: boolean) {
    if (!on) return; // turning location off is done in the phone's settings
    try { const r = await Location.requestForegroundPermissionsAsync(); setGranted(r.status === "granted"); setDenied(r.status !== "granted"); }
    catch { setDenied(true); }
  }

  return (
    <Screen scroll>
      <Stagger i={0} style={{ marginTop: 28 }}>
        <Text style={type.label}>Step 1 of 2</Text>
        <Text style={[type.title, { marginTop: 6 }]}>Let's get your phone ready</Text>
        <Text style={[type.small, { marginTop: 8 }]}>The app needs your location to punch you in at the store and to share your delivery progress.</Text>
      </Stagger>
      <View style={{ gap: space.md, marginTop: space.xl }}>
        <Stagger i={1}>
          <Card style={[s.row, granted && { borderColor: colors.green }]}>
            <View style={[s.icon, granted && { backgroundColor: colors.greenSoft }]}><Icon name={granted ? "check" : "map-pin"} size={22} color={granted ? colors.green : colors.maroon} /></View>
            <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>Location</Text><Text style={[type.small, { marginTop: 2 }]}>{denied && !granted ? "Blocked. Allow it in your phone's settings, then come back." : "Used when you punch in and while you deliver."}</Text></View>
            <Switch value={granted} onChange={v => void ask(v)} />
          </Card>
        </Stagger>
        {LATER.map((it, i) => (
          <Stagger key={it.title} i={i + 2}>
            <Card style={[s.row, { opacity: 0.55 }]}>
              <View style={s.icon}><Icon name={it.icon} size={22} color={colors.maroon} /></View>
              <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{it.title}</Text><Text style={[type.small, { marginTop: 2 }]}>{it.why}</Text></View>
              <Text style={s.soon}>Soon</Text>
            </Card>
          </Stagger>
        ))}
      </View>
      <Stagger i={6} style={{ marginTop: 28 }}>
        <Button label="Continue" icon="arrow-right" disabled={!granted} onPress={() => router.replace("/start-shift")} />
      </Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 2, borderColor: "transparent" },
  icon: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  soon: { fontSize: 11, fontWeight: "800", color: colors.muted, letterSpacing: 0.5 },
});
