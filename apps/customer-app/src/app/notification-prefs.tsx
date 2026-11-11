import { useEffect, useState } from "react";
import { ActivityIndicator, Switch, Text, View } from "react-native";
import { getPrefs, savePrefs, type NotifPrefs } from "../api/account";
import { Card, Header, Screen } from "../components/ui";
import { colors, space, type } from "../theme";

const ROWS: { key: keyof NotifPrefs; title: string; sub: string }[] = [
  { key: "promoPush", title: "Offers and news (app)", sub: "Deals and new arrivals as app notifications" },
  { key: "promoWhatsApp", title: "Offers on WhatsApp", sub: "Promotional messages on WhatsApp" },
  { key: "cartReminders", title: "Cart reminders", sub: "A nudge if you leave items in your cart" },
];

/** Screen 36. Order updates are always on; only promotions can be switched off. */
export default function NotificationPrefs() {
  const [p, setP] = useState<NotifPrefs | null>(null); const [err, setErr] = useState("");
  useEffect(() => { void getPrefs().then(setP).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load.")); }, []);
  const toggle = async (k: keyof NotifPrefs, v: boolean) => {
    if (!p) return; const prev = p; setP({ ...p, [k]: v });
    try { setP(await savePrefs({ [k]: v })); } catch { setP(prev); setErr("Couldn't save that change."); }
  };
  return (
    <Screen scroll>
      <Header title="Notifications" />
      <Card style={{ backgroundColor: colors.greenSoft }}>
        <Text style={type.body}>Order updates are always on, so you never miss your delivery.</Text>
      </Card>
      {!p && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 40 }} />}
      {!!err && <Text style={[type.small, { color: colors.red, marginTop: space.md }]}>{err}</Text>}
      {p && (
        <Card style={{ marginTop: space.md, gap: space.lg }}>
          {ROWS.map(r => (
            <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "700" }]}>{r.title}</Text><Text style={type.small}>{r.sub}</Text></View>
              <Switch value={p[r.key]} onValueChange={v => void toggle(r.key, v)} trackColor={{ true: colors.maroon, false: colors.line }} thumbColor={colors.white} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
