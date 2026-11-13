import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ackAssignment } from "../api/rider";
import { SwipeButton } from "../components/SwipeButton";
import { Card, Icon, Press, Screen } from "../components/ui";
import { useStore } from "../state/store";
import { colors, radius, rupees, type } from "../theme";

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * A new delivery waiting for the rider. It is an ordinary screen (no alarm, no full-screen takeover): the rider reaches it from the
 * notification or from the banner on Home, and slides to accept.
 */
export default function NewDelivery() {
  const { ringing, refreshOrders } = useStore();
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const order = ringing?.orders[0];
  const deadline = ringing?.ackDeadlineAt ? Date.parse(ringing.ackDeadlineAt) : null;
  const [left, setLeft] = useState(deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null);

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [deadline]);

  // Accepted elsewhere, cancelled or taken back: nothing is left to accept.
  useEffect(() => { if (!ringing) router.replace("/(tabs)"); }, [ringing]);
  if (!ringing || !order) return null;

  async function accept() {
    if (!ringing || !order) return;
    setError("");
    try {
      await ackAssignment(ringing.id);
      await refreshOrders().catch(() => undefined);
      router.replace({ pathname: "/order/[id]", params: { id: order.id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not accept this delivery."); setResetKey(k => k + 1); }
  }

  const items = ringing.orders.reduce((a, o) => a + o.itemCount, 0);
  const due = ringing.orders.reduce((a, o) => a + (o.paymentStatus.startsWith("cod") ? o.amountDue : 0), 0);

  return (
    <Screen scroll>
      <View style={s.head}>
        <Press onPress={() => router.back()} haptic style={s.back}><Icon name="arrow-left" size={20} color={colors.maroon} /></Press>
        <Text style={type.label}>NEW DELIVERY</Text>
      </View>
      <Text style={[type.title, { marginTop: 14 }]}>{ringing.orders.map(o => o.orderNo).join(" + ")}</Text>
      <Text style={[type.small, { marginTop: 4 }]}>{order.warehouse.name}{left !== null ? ` · accept within ${mmss(left)}` : ""}</Text>

      <Card style={{ marginTop: 20, gap: 14 }}>
        <Fact icon="map-pin" label="Deliver to" value={order.locality} />
        <Fact icon="shopping-bag" label="To carry" value={`${items} ${items === 1 ? "item" : "items"}`} />
        <Fact icon="clock" label="Promised by" value={hhmm(order.promisedAt)} />
        <Fact icon="credit-card" label={due > 0 ? "Collect in cash" : "Payment"} value={due > 0 ? rupees(due) : "Already paid"} />
      </Card>

      {error ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, textAlign: "center", marginTop: 14 }}>{error}</Text> : null}
      <View style={{ marginTop: 24 }}><SwipeButton label="Slide to accept" icon="check" tone="green" resetKey={resetKey} onConfirm={() => void accept()} /></View>
      <Press onPress={() => router.push("/problem")} haptic style={s.problem}><Icon name="alert-circle" size={16} color={colors.muted} /><Text style={s.problemText}>Report a problem</Text></Press>
    </Screen>
  );
}

function Fact({ icon, value, label }: { icon: React.ComponentProps<typeof Icon>["name"]; value: string; label: string }) {
  return (
    <View style={s.fact}>
      <View style={s.factIcon}><Icon name={icon} size={18} color={colors.maroon} /></View>
      <View style={{ flex: 1 }}><Text style={s.factLabel}>{label}</Text><Text style={s.factValue} numberOfLines={2}>{value}</Text></View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  back: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  fact: { flexDirection: "row", alignItems: "center", gap: 12 },
  factIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  factLabel: { fontSize: 12, fontWeight: "700", color: colors.muted },
  factValue: { fontSize: 15, fontWeight: "800", color: colors.ink },
  problem: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", padding: 14, marginTop: 8 },
  problemText: { color: colors.muted, fontWeight: "800", fontSize: 13 },
});
