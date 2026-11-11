import { LinearGradient } from "expo-linear-gradient";
import { liftIn } from "../../motion";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { getCash, type CashSummary } from "../../api/rider";
import { useCountUp } from "../../components/effects";
import { Button, Card, Icon, Screen, SectionTitle, Stagger } from "../../components/ui";
import { colors, radius, rupees, shadow, type } from "../../theme";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
const LABEL: Record<string, string> = { collected: "Cash collected", deposit: "Deposited at store", adjustment: "Adjustment" };

export default function Cash() {
  const [cash, setCash] = useState<CashSummary | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setCash(await getCash()); } catch (e) { setError(e instanceof Error ? e.message : "Could not load your cash."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useCountUp((cash?.cashInHand ?? 0) / 100, 1200);
  const collected = (cash?.entries ?? []).filter(l => l.type === "collected").reduce((a, l) => a + l.amount, 0);

  return (
    <Screen scroll bottomPad={120}>
      <Stagger i={0} style={{ marginTop: 18 }}><Text style={type.title}>Cash</Text><Text style={[type.small, { marginTop: 4 }]}>Money you're carrying for the store</Text></Stagger>
      {error ? <View style={{ marginTop: 16, gap: 10 }}><Text style={{ color: colors.red, fontWeight: "700" }}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} /></View> : null}
      <Stagger i={1} style={{ marginTop: 20 }}>
        <LinearGradient colors={[colors.maroon, colors.maroonSoft]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.balance}>
          <View style={s.glow} />
          <Text style={s.balLabel}>CASH IN HAND</Text>
          <Text style={s.balValue}>₹{shown.toLocaleString("en-IN")}</Text>
          <View style={s.balFoot}>
            <View style={s.balPill}><Icon name="arrow-down-left" size={14} color={colors.maroon} /><Text style={s.balPillText}>{rupees(collected)} collected</Text></View>
            <Text style={s.balHint}>Hand it to the store at the end of your shift</Text>
          </View>
        </LinearGradient>
      </Stagger>

      {(cash?.byWarehouse.length ?? 0) > 1 && (
        <Stagger i={2} style={{ marginTop: 12 }}>
          <Card style={{ gap: 6 }}>{cash!.byWarehouse.map(w => (
            <View key={w.warehouseId} style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={type.body}>{w.warehouseName}</Text><Text style={[type.body, { fontWeight: "900" }]}>{rupees(w.amount)}</Text></View>
          ))}</Card>
        </Stagger>
      )}

      {(cash?.pendingUpi.length ?? 0) > 0 && (
        <>
          <SectionTitle>UPI waiting to be checked</SectionTitle>
          {cash!.pendingUpi.map(u => (
            <Card key={u.orderId} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 10 }}>
              <View style={[s.dot, { backgroundColor: colors.blueSoft }]}><Icon name="smartphone" size={18} color={colors.blue} /></View>
              <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{u.orderNo}</Text><Text style={type.small}>Not counted until your manager confirms</Text></View>
              <Text style={[type.body, { fontWeight: "900" }]}>{rupees(u.amount)}</Text>
            </Card>
          ))}
        </>
      )}

      <SectionTitle>Ledger</SectionTitle>
      {cash && cash.entries.length === 0 && <Text style={type.small}>No cash movements yet.</Text>}
      {(cash?.entries ?? []).map((l, i) => (
        <Animated.View key={l.id} entering={liftIn(200 + Math.min(i, 8) * 50)} style={{ marginBottom: 10 }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
            <View style={[s.dot, { backgroundColor: l.amount < 0 ? colors.blueSoft : colors.greenSoft }]}><Icon name={l.amount < 0 ? "arrow-up-right" : "arrow-down-left"} size={18} color={l.amount < 0 ? colors.blue : colors.green} /></View>
            <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{LABEL[l.type] ?? l.type}{l.orderNo ? ` · ${l.orderNo}` : ""}</Text><Text style={type.small}>{when(l.at)}</Text></View>
            <Text style={[type.body, { fontWeight: "900", color: l.amount < 0 ? colors.blue : colors.green }]}>{l.amount < 0 ? "−" : "+"}{rupees(Math.abs(l.amount))}</Text>
          </Card>
        </Animated.View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  balance: { borderRadius: radius.xl, padding: 22, overflow: "hidden", ...shadow.lift },
  glow: { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(255,201,51,0.14)", top: -80, right: -60 },
  balLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "800", letterSpacing: 1.4 },
  balValue: { color: colors.white, fontSize: 46, fontWeight: "900", letterSpacing: -1.5, marginTop: 6 },
  balFoot: { marginTop: 18, gap: 10 },
  balPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: colors.yellow, paddingHorizontal: 12, height: 30, borderRadius: 15 },
  balPillText: { fontWeight: "800", color: colors.maroon, fontSize: 12 },
  balHint: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: "600" },
  dot: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
