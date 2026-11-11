import { useCallback, useEffect, useState } from "react";
import { liftIn } from "../motion";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { getHistory, type HistoryItem } from "../api/rider";
import { Button, Card, Header, Icon, Pill, Screen, Stagger } from "../components/ui";
import { colors, rupees, type } from "../theme";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "");

export default function History() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [today, setToday] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    setBusy(true); setError("");
    try {
      const page = await getHistory(cursor);
      setItems(prev => (cursor && prev ? [...prev, ...page.items] : page.items)); setNext(page.nextCursor); setToday(page.deliveredToday);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your history."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const delivered = (items ?? []).filter(h => h.status === "DELIVERED").length;
  const failed = (items ?? []).length - delivered;

  return (
    <Screen scroll>
      <Header title="Delivery history" />
      <Stagger i={0} style={s.summary}>
        <View style={s.cell}><Text style={s.big}>{today}</Text><Text style={type.small}>Delivered today</Text></View>
        <View style={s.sep} />
        <View style={s.cell}><Text style={s.big}>{delivered}</Text><Text style={type.small}>Delivered</Text></View>
        <View style={s.sep} />
        <View style={s.cell}><Text style={[s.big, { color: failed ? colors.red : colors.ink }]}>{failed}</Text><Text style={type.small}>Failed</Text></View>
      </Stagger>
      {error ? <View style={{ gap: 10 }}><Text style={{ color: colors.red, fontWeight: "700" }}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} /></View> : null}
      {items && items.length === 0 && !error && <Text style={[type.small, { textAlign: "center", marginTop: 30 }]}>No deliveries yet.</Text>}
      <View style={{ gap: 10, marginTop: 8 }}>
        {(items ?? []).map((h, i) => {
          const ok = h.status === "DELIVERED";
          return (
            <Animated.View key={h.orderId} entering={liftIn(120 + Math.min(i, 9) * 50)}>
              <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                <View style={[s.dot, { backgroundColor: ok ? colors.greenSoft : colors.redSoft }]}><Icon name={ok ? "check" : "x"} size={18} color={ok ? colors.green : colors.red} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontWeight: "800" }]}>{h.orderNo}</Text>
                  <Text style={type.small}>{when(h.deliveredAt)}{h.deliveredOffline ? " · offline" : ""}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={[type.body, { fontWeight: "900" }]}>{h.amountDue ? rupees(h.amountDue) : "—"}</Text>
                  <Pill label={!ok ? "FAILED" : h.collectionMethod === "cash" ? "CASH" : h.collectionMethod ? "UPI" : "PREPAID"} tone={!ok ? "red" : h.collectionMethod ? "amber" : "green"} />
                </View>
              </Card>
            </Animated.View>
          );
        })}
      </View>
      {next && <View style={{ marginTop: 16 }}><Button label={busy ? "Loading…" : "Load more"} variant="soft" disabled={busy} onPress={() => void load(next)} /></View>}
    </Screen>
  );
}

const s = StyleSheet.create({
  summary: { flexDirection: "row", backgroundColor: colors.white, borderRadius: 22, paddingVertical: 18, marginVertical: 16, alignItems: "center" },
  cell: { flex: 1, alignItems: "center" },
  sep: { width: 1, height: 36, backgroundColor: colors.line },
  big: { fontSize: 22, fontWeight: "900", color: colors.ink, letterSpacing: -0.5 },
  dot: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
