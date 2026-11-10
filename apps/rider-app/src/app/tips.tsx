import { useCallback, useEffect, useState } from "react";
import { liftIn } from "../motion";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { getTips, type Tips as TipsData } from "../api/rider";
import { Button, Card, Header, Pill, Screen, Stagger } from "../components/ui";
import { colors, rupees, type } from "../theme";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

export default function Tips() {
  const [tips, setTips] = useState<TipsData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setError(""); try { setTips(await getTips()); } catch (e) { setError(e instanceof Error ? e.message : "Could not load your tips."); } }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Screen scroll>
      <Header title="Tips" subtitle={tips ? `${day(tips.from)} – ${day(tips.to)}` : "Last 7 days"} />
      {error ? <View style={{ gap: 10, marginTop: 16 }}><Text style={{ color: colors.red, fontWeight: "700" }}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} /></View> : null}
      {tips && (
        <>
          <Stagger i={0} style={s.summary}>
            <View style={s.cell}><Text style={s.big}>{rupees(tips.totals.total)}</Text><Text style={type.small}>Earned</Text></View>
            <View style={s.sep} />
            <View style={s.cell}><Text style={[s.big, { color: colors.amber }]}>{rupees(tips.totals.owed)}</Text><Text style={type.small}>Still owed</Text></View>
            <View style={s.sep} />
            <View style={s.cell}><Text style={[s.big, { color: colors.green }]}>{rupees(tips.totals.paid)}</Text><Text style={type.small}>Paid</Text></View>
          </Stagger>
          {tips.items.length === 0 && <Text style={[type.small, { textAlign: "center", marginTop: 30 }]}>No tips in this period.</Text>}
          <View style={{ gap: 10 }}>
            {tips.items.map((t, i) => (
              <Animated.View key={t.orderId} entering={liftIn(120 + Math.min(i, 9) * 50)}>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                  <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{t.orderNo}</Text><Text style={type.small}>{day(t.deliveredAt)}</Text></View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={[type.body, { fontWeight: "900" }]}>{rupees(t.amount)}</Text>
                    <Pill label={t.status === "paid" ? "PAID" : "OWED"} tone={t.status === "paid" ? "green" : "amber"} />
                  </View>
                </Card>
              </Animated.View>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  summary: { flexDirection: "row", backgroundColor: colors.white, borderRadius: 22, paddingVertical: 18, marginVertical: 16, alignItems: "center" },
  cell: { flex: 1, alignItems: "center" },
  sep: { width: 1, height: 36, backgroundColor: colors.line },
  big: { fontSize: 20, fontWeight: "900", color: colors.ink, letterSpacing: -0.5 },
});
