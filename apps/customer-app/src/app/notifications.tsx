import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { listOrders, statusInfo, trackingHeadline, type OrderSummary } from "../api/orders";
import { Button, Card, Header, Icon, Pill, Press, Screen } from "../components/ui";
import { useStore } from "../state/store";
import { colors, rupees, space, type } from "../theme";

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "Just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/** Screen 10: order updates. Built from the customer's orders (the server has no inbox yet); push alerts arrive with the development build. */
export default function Notifications() {
  const { signedIn } = useStore();
  const [rows, setRows] = useState<OrderSummary[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    setErr("");
    void Promise.all([listOrders("active"), listOrders("past")])
      .then(([a, p]) => setRows([...a.items, ...p.items].sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt)).slice(0, 20)))
      .catch(e => setErr(e instanceof Error ? e.message : "Couldn't load updates."));
  }, []);
  useEffect(() => { if (signedIn) load(); else setRows([]); }, [signedIn, load]);

  return (
    <Screen scroll>
      <Header title="Updates" />
      {!signedIn && <View style={{ alignItems: "center", gap: space.md, marginTop: 70 }}><Icon name="bell" size={40} color={colors.faint} /><Text style={type.small}>Sign in to see your order updates.</Text><Button label="Sign in" onPress={() => router.push("/login")} /></View>}
      {signedIn && !rows && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
      {!!err && <View style={{ alignItems: "center", gap: space.md, marginTop: 60 }}><Text style={type.small}>{err}</Text><Button label="Try again" variant="soft" onPress={load} /></View>}
      {signedIn && rows?.length === 0 && <View style={{ alignItems: "center", gap: space.sm, marginTop: 80 }}><Icon name="bell" size={40} color={colors.faint} /><Text style={type.h2}>No updates yet</Text><Text style={type.small}>Order updates will show up here.</Text></View>}
      <View style={{ gap: space.md }}>
        {rows?.map(o => {
          const st = o.children[0]?.status ?? o.status; const info = statusInfo(st); const head = trackingHeadline(st);
          return (
            <Press key={o.groupId} haptic onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.groupId } })}>
              <Card style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text style={[type.body, { fontWeight: "900", flex: 1 }]}>{head.title}</Text><Pill label={info.label.toUpperCase()} tone={info.tone} />
                </View>
                <Text style={type.small}>{o.groupNo} · {rupees(o.total)} · {ago(o.createdAt)}</Text>
                {!!head.sub && <Text style={type.small}>{head.sub}</Text>}
              </Card>
            </Press>
          );
        })}
      </View>
    </Screen>
  );
}
