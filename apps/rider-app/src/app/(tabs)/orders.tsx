import { router } from "expo-router";
import { liftIn } from "../../motion";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOutLeft, LinearTransition } from "react-native-reanimated";
import { getHistory, stageOf, type HistoryItem, type Stage } from "../../api/rider";
import { Button, Card, Chip, Icon, Pill, Press, Screen, Stagger } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, rupees, type } from "../../theme";

const STAGE: Record<Stage, { label: string; tone: "blue" | "amber" | "green" | "red" | "maroon" }> = {
  assigned: { label: "New", tone: "blue" }, picked_up: { label: "Picked up", tone: "amber" }, out_for_delivery: { label: "On the way", tone: "amber" },
  arrived: { label: "At door", tone: "green" }, delivered: { label: "Delivered", tone: "green" }, failed: { label: "Failed", tone: "red" },
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "");
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : null);

export default function Orders() {
  const { orders, refreshOrders } = useStore();
  const [tab, setTab] = useState<"active" | "done">("active");
  const [done, setDone] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState("");

  const loadDone = useCallback(async () => {
    setError("");
    try { setDone((await getHistory()).items.slice(0, 20)); } catch (e) { setError(e instanceof Error ? e.message : "Could not load your completed orders."); }
  }, []);
  useEffect(() => { void refreshOrders().catch(() => undefined); }, [refreshOrders]);
  useEffect(() => { if (tab === "done") void loadDone(); }, [tab, loadDone]);

  return (
    <Screen scroll bottomPad={120}>
      <Stagger i={0} style={{ marginTop: 18 }}><Text style={type.title}>Orders</Text><Text style={[type.small, { marginTop: 4 }]}>{orders.length} active</Text></Stagger>
      <Stagger i={1} style={{ flexDirection: "row", gap: 10, marginTop: 18, marginBottom: 6 }}>
        <Chip label={`Active (${orders.length})`} active={tab === "active"} onPress={() => setTab("active")} icon="zap" />
        <Chip label="Completed" active={tab === "done"} onPress={() => setTab("done")} icon="check-circle" />
      </Stagger>

      {tab === "active" && (orders.length === 0 ? (
        <Animated.View entering={FadeIn.delay(100)} style={s.empty}>
          <View style={s.emptyIcon}><Icon name="package" size={34} color={colors.maroon} /></View>
          <Text style={[type.h2, { marginTop: 18 }]}>No active orders</Text>
          <Text style={[type.small, { textAlign: "center", marginTop: 6 }]}>New deliveries show up here the moment they're assigned to you.</Text>
        </Animated.View>
      ) : orders.map((o, i) => {
        const stage = stageOf(o.status);
        const promised = hhmm(o.promisedAt);
        return (
          <Animated.View key={o.id} entering={liftIn(i * 80)} exiting={FadeOutLeft} layout={LinearTransition.duration(260)} style={{ marginTop: 14 }}>
            <Press haptic onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.id } })}>
              <Card>
                <View style={s.top}>
                  <Text style={s.no}>{o.orderNo}</Text>
                  <Pill label={o.acknowledged ? STAGE[stage].label : "Not accepted"} tone={o.acknowledged ? STAGE[stage].tone : "red"} />
                </View>
                <Text style={[type.body, { fontWeight: "700", marginTop: 10 }]}>{o.customerName}</Text>
                <Text style={[type.small, { marginTop: 2 }]} numberOfLines={1}>{o.locality}</Text>
                <View style={s.meta}>
                  <View style={s.metaItem}><Icon name="shopping-bag" size={14} color={colors.muted} /><Text style={s.metaText}>{o.itemCount} {o.itemCount === 1 ? "item" : "items"}</Text></View>
                  {promised && <View style={s.metaItem}><Icon name="clock" size={14} color={colors.muted} /><Text style={s.metaText}>by {promised}</Text></View>}
                  <Text style={[s.metaText, { marginLeft: "auto", color: colors.maroon, fontWeight: "900" }]}>{o.alreadyPaid || o.amountDue === 0 ? "Prepaid" : rupees(o.amountDue)}</Text>
                </View>
              </Card>
            </Press>
          </Animated.View>
        );
      }))}

      {tab === "done" && (
        error ? <View style={{ marginTop: 20, gap: 12 }}><Text style={{ color: colors.red, fontWeight: "700" }}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void loadDone()} /></View>
          : done === null ? <Text style={[type.small, { marginTop: 24, textAlign: "center" }]}>Loading…</Text>
          : done.length === 0 ? <Text style={[type.small, { marginTop: 24, textAlign: "center" }]}>Nothing delivered yet.</Text>
          : done.map((h, i) => {
            const ok = h.status === "DELIVERED";
            return (
              <Animated.View key={h.orderId} entering={liftIn(i * 50)} style={{ marginTop: 12 }}>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={[s.dot, { backgroundColor: ok ? colors.greenSoft : colors.redSoft }]}><Icon name={ok ? "check" : "x"} size={18} color={ok ? colors.green : colors.red} /></View>
                  <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{h.orderNo}</Text><Text style={type.small}>{when(h.deliveredAt)}</Text></View>
                  <Text style={[type.body, { fontWeight: "900" }]}>{h.amountDue ? rupees(h.amountDue) : "Prepaid"}</Text>
                </Card>
              </Animated.View>
            );
          })
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  no: { fontSize: 17, fontWeight: "900", color: colors.ink, letterSpacing: -0.3 },
  meta: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  empty: { alignItems: "center", marginTop: 70, paddingHorizontal: 30 },
  emptyIcon: { width: 86, height: 86, borderRadius: 30, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  dot: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
