import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { cancelNotifyMe, listNotifyMe, type NotifySub } from "../api/account";
import { Button, Card, Header, Icon, Press, Screen } from "../components/ui";
import { colors, space, type } from "../theme";

/** Screen 15: items the customer asked to hear about when they're back in stock. */
export default function NotifyMe() {
  const [rows, setRows] = useState<NotifySub[] | null>(null); const [err, setErr] = useState("");
  const load = () => { setErr(""); void listNotifyMe().then(setRows).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load.")); };
  useEffect(load, []);
  const remove = async (id: string) => { setRows(r => r?.filter(x => x.id !== id) ?? r); try { await cancelNotifyMe(id); } catch { load(); } };
  return (
    <Screen scroll>
      <Header title="Back-in-stock alerts" />
      {!rows && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
      {!!err && <View style={{ alignItems: "center", gap: space.md, marginTop: 60 }}><Text style={type.small}>{err}</Text><Button label="Try again" variant="soft" onPress={load} /></View>}
      {rows?.length === 0 && (
        <View style={{ alignItems: "center", gap: space.sm, marginTop: 80 }}>
          <Icon name="bell" size={40} color={colors.faint} /><Text style={type.h2}>No alerts yet</Text>
          <Text style={[type.small, { textAlign: "center" }]}>Tap "Notify me" on a sold-out product and we'll tell you when it's back.</Text>
        </View>
      )}
      <View style={{ gap: space.md }}>
        {rows?.map(r => (
          <Card key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Press style={{ flex: 1 }} onPress={() => router.push({ pathname: "/product/[id]", params: { id: r.productId } })}>
              <Text style={[type.body, { fontWeight: "800" }]}>{r.name}</Text>
              <Text style={type.small}>{r.variantLabel ?? "Any size"} · waiting since {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Text>
            </Press>
            <Press haptic onPress={() => void remove(r.id)}><Icon name="trash-2" size={20} color={colors.red} /></Press>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
