import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { pickup } from "../../api/rider";
import { OrderGate } from "../../components/OrderGate";
import { SwipeButton } from "../../components/SwipeButton";
import { Card, Header, Icon, Press, Screen, Stagger } from "../../components/ui";
import { smooth } from "../../motion";
import { useStore } from "../../state/store";
import { useOrderDetail } from "../../state/useOrderDetail";
import { colors, radius, type } from "../../theme";

function Check({ on }: { on: boolean }) {
  return (
    <View style={[s.box, on && { backgroundColor: colors.green, borderColor: colors.green }]}>
      {on && <Animated.View entering={FadeIn.duration(140)}><Icon name="check" size={18} color={colors.white} /></Animated.View>}
    </View>
  );
}

export default function Pickup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refreshOrders } = useStore();
  const { detail: o, error, loading, reload } = useOrderDetail(id);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [bags, setBags] = useState(0);
  const [failure, setFailure] = useState("");
  const [resetKey, setResetKey] = useState(0);

  const expectedBags = o?.bagCount ?? null;
  const bagsOk = expectedBags !== null ? bags === expectedBags : bags >= 1;
  const total = (o?.items.length ?? 0) + 1;
  const done = Object.values(checked).filter(Boolean).length + (o && bagsOk ? 1 : 0);
  const ready = !!o && done === total;
  const p = useSharedValue(0);
  useEffect(() => { p.value = smooth(total ? done / total : 0); }, [done, total, p]);
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  if (!o) return <OrderGate title="Pickup checklist" loading={loading} error={error} onRetry={() => void reload()} />;

  async function confirm() {
    if (!o) return;
    setFailure("");
    try {
      await pickup(o.id, bags);
      await refreshOrders().catch(() => undefined);
      router.replace({ pathname: "/order/ride", params: { id: o.id } });
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not record the pickup."); setResetKey(k => k + 1); }
  }

  return (
    <Screen scroll bottomPad={36}>
      <Header title="Pickup checklist" subtitle={`${o.orderNo} · ${o.warehouse.name}`} />
      <Stagger i={0}>
        <View style={s.progressRow}><Text style={type.label}>Verify before you leave</Text><Text style={[type.small, { fontWeight: "800", color: ready ? colors.green : colors.muted }]}>{done}/{total}</Text></View>
        <View style={s.track}><Animated.View style={[s.fill, fill, ready && { backgroundColor: colors.green }]} /></View>
      </Stagger>

      <View style={{ gap: 10, marginTop: 20 }}>
        {o.items.map((it, i) => (
          <Stagger key={`${it.name}-${i}`} i={Math.min(i, 6) + 1}>
            <Press haptic onPress={() => setChecked(c => ({ ...c, [i]: !c[i] }))} style={[s.row, checked[i] && { backgroundColor: colors.greenSoft }]}>
              <Check on={!!checked[i]} />
              <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800", textDecorationLine: checked[i] ? "line-through" : "none", opacity: checked[i] ? 0.55 : 1 }]}>{it.name}</Text>{it.variantLabel ? <Text style={type.small}>{it.variantLabel}</Text> : null}</View>
              <View style={s.qty}><Text style={s.qtyText}>×{it.qty}</Text></View>
            </Press>
          </Stagger>
        ))}
      </View>

      <Stagger i={8}>
        <Card style={{ marginTop: 18, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={s.bag}><Icon name="shopping-bag" size={22} color={colors.maroon} /></View>
          <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>Count the bags</Text><Text style={type.small}>{expectedBags !== null ? `The packing slip says ${expectedBags}` : "Enter how many bags you are carrying"}</Text></View>
          <View style={s.stepper}>
            <Press haptic onPress={() => setBags(b => Math.max(0, b - 1))} style={s.stepBtn}><Icon name="minus" size={18} /></Press>
            <Text style={[s.bagCount, bagsOk && { color: colors.green }]}>{bags}</Text>
            <Press haptic onPress={() => setBags(b => Math.min(50, b + 1))} style={s.stepBtn}><Icon name="plus" size={18} /></Press>
          </View>
        </Card>
      </Stagger>

      {failure ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 14 }}>{failure}</Text> : null}
      <View style={{ flex: 1, minHeight: 30 }} />
      <Stagger i={9}><SwipeButton label={ready ? "Slide: I have picked up" : "Tick every item to continue"} icon="package" tone="green" disabled={!ready} resetKey={resetKey} onConfirm={() => void confirm()} /></Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.creamDeep, marginTop: 10, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.maroon },
  row: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.white, padding: 14, borderRadius: radius.lg },
  box: { width: 32, height: 32, borderRadius: 11, borderWidth: 2.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  qty: { backgroundColor: colors.yellowSoft, borderRadius: 10, paddingHorizontal: 10, height: 30, alignItems: "center", justifyContent: "center" },
  qtyText: { fontWeight: "900", color: colors.maroon },
  bag: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.creamDeep, alignItems: "center", justifyContent: "center" },
  bagCount: { fontSize: 22, fontWeight: "900", minWidth: 22, textAlign: "center", color: colors.ink },
});
