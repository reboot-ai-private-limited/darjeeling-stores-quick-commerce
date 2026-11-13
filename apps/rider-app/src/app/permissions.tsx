import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Switch } from "../components/Switch";
import { Button, Card, Icon, Screen, Stagger } from "../components/ui";
import { askNotificationPermission, notificationPermission } from "../push";
import { askBackgroundPermission, backgroundPermission, type BackgroundPermission } from "../tracking";
import { colors, space, type } from "../theme";

export default function Permissions() {
  const [granted, setGranted] = useState(false);
  const [denied, setDenied] = useState(false);
  const [always, setAlways] = useState<BackgroundPermission>("denied");
  const [notify, setNotify] = useState<"granted" | "denied" | "unavailable">("denied");

  const check = useCallback(async () => { try { setGranted((await Location.getForegroundPermissionsAsync()).status === "granted"); } catch { /* unavailable */ } }, []);
  useEffect(() => { void check(); void notificationPermission().then(setNotify); void backgroundPermission().then(setAlways); }, [check]);

  async function ask(on: boolean) {
    if (!on) return; // turning location off is done in the phone's settings
    try { const r = await Location.requestForegroundPermissionsAsync(); setGranted(r.status === "granted"); setDenied(r.status !== "granted"); }
    catch { setDenied(true); }
  }

  async function askAlways(on: boolean) { if (on) setAlways(await askBackgroundPermission()); }
  async function askNotify(on: boolean) { if (on) setNotify(await askNotificationPermission()); }

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
        <Stagger i={2}>
          <Card style={[s.row, always === "granted" && { borderColor: colors.green }]}>
            <View style={[s.icon, always === "granted" && { backgroundColor: colors.greenSoft }]}><Icon name={always === "granted" ? "check" : "navigation"} size={22} color={always === "granted" ? colors.green : colors.maroon} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "800" }]}>Location, all the time</Text>
              <Text style={[type.small, { marginTop: 2 }]}>{always === "unavailable" ? "Not available in this test app. It works in the installed app." : "So customers can follow your delivery even when the screen is locked. Choose “Allow all the time”."}</Text>
            </View>
            {always !== "unavailable" && <Switch value={always === "granted"} onChange={v => void askAlways(v)} />}
          </Card>
        </Stagger>
        <Stagger i={3}>
          <Card style={[s.row, notify === "granted" && { borderColor: colors.green }]}>
            <View style={[s.icon, notify === "granted" && { backgroundColor: colors.greenSoft }]}><Icon name={notify === "granted" ? "check" : "bell"} size={22} color={notify === "granted" ? colors.green : colors.maroon} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "800" }]}>Notifications</Text>
              <Text style={[type.small, { marginTop: 2 }]}>{notify === "unavailable" ? "Not available in this test app. They work in the installed app." : "A new delivery rings your phone, even when the app is closed."}</Text>
            </View>
            {notify !== "unavailable" && <Switch value={notify === "granted"} onChange={v => void askNotify(v)} />}
          </Card>
        </Stagger>
      </View>
      <Stagger i={4} style={{ marginTop: 28 }}>
        <Button label="Continue" icon="arrow-right" disabled={!granted || always === "denied"} onPress={() => router.replace("/start-shift")} />
      </Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 2, borderColor: "transparent" },
  icon: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
});
