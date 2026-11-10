import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle } from "react-native-reanimated";
import { ApiError } from "../../api/http";
import { collectCash, collectUpi } from "../../api/rider";
import { useCountUp } from "../../components/effects";
import { OrderGate } from "../../components/OrderGate";
import { SwipeButton } from "../../components/SwipeButton";
import { Card, Header, Icon, Screen, Stagger, tap } from "../../components/ui";
import { smooth } from "../../motion";
import { useStore } from "../../state/store";
import { useOrderDetail } from "../../state/useOrderDetail";
import { colors, radius, rupees, shadow, type } from "../../theme";
import { finishDelivery } from "./arrived";

export default function Payment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { otpOf, refresh } = useStore();
  const { detail: o, error, loading, reload } = useOrderDetail(id);
  const [method, setMethod] = useState<"cash" | "upi">("cash");
  const [w, setW] = useState(0);
  const [failure, setFailure] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const amount = useCountUp((o?.amountDue ?? 0) / 100, 900);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: smooth(method === "cash" ? 0 : w / 2) }] }), [method, w]);
  if (!o) return <OrderGate title="Collect payment" loading={loading} error={error} onRetry={() => void reload()} />;

  const paid = alreadyPaid || o.alreadyPaid;
  const pick = (m: "cash" | "upi") => { tap(); setMethod(m); };

  async function done() {
    if (!o) return;
    setFailure("");
    try {
      if (!paid) {
        try { await (method === "cash" ? collectCash(o.id, o.amountDue) : collectUpi(o.id, o.amountDue)); }
        catch (e) {
          if (e instanceof ApiError && e.details?.reason === "already_paid") { setAlreadyPaid(true); setResetKey(k => k + 1); return; }
          throw e;
        }
      }
      await finishDelivery(o, otpOf(o.id));
      await refresh().catch(() => undefined);
      router.replace({ pathname: "/order/delivered", params: { no: o.orderNo, amount: paid ? "0" : String(o.amountDue), method: paid ? "prepaid" : method } });
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not record the payment."); setResetKey(k => k + 1); }
  }

  return (
    <Screen scroll bottomPad={36}>
      <Header title="Collect payment" subtitle={`${o.orderNo} · ${o.customer.name}`} />
      {paid ? (
        <Animated.View entering={FadeIn} style={s.paid}>
          <Icon name="alert-octagon" size={40} color={colors.white} />
          <Text style={s.paidTitle}>Already paid</Text>
          <Text style={s.paidText}>The customer paid online. Do not collect any money.</Text>
        </Animated.View>
      ) : (
        <>
          <Stagger i={0}>
            <View style={s.amountWrap}>
              <Text style={type.label}>Amount due</Text>
              <Text style={s.amount}>₹{amount.toLocaleString("en-IN")}</Text>
              <Text style={[type.small, { textAlign: "center" }]}>Collect exactly {rupees(o.amountDue)}. No more, no less.</Text>
            </View>
          </Stagger>
          <Stagger i={1}>
            <View style={s.seg} onLayout={e => setW(e.nativeEvent.layout.width - 8)}>
              <Animated.View style={[s.segKnob, { width: w / 2 }, slide]} />
              <Pressable style={s.segItem} onPress={() => pick("cash")}><Icon name="dollar-sign" size={17} color={method === "cash" ? colors.white : colors.muted} /><Text style={[s.segText, method === "cash" && { color: colors.white }]}>Cash</Text></Pressable>
              <Pressable style={s.segItem} onPress={() => pick("upi")}><Icon name="smartphone" size={17} color={method === "upi" ? colors.white : colors.muted} /><Text style={[s.segText, method === "upi" && { color: colors.white }]}>UPI</Text></Pressable>
            </View>
          </Stagger>
          <View style={{ marginTop: 18 }}>
            {method === "cash" ? (
              <View key="cash">
                <Card style={{ alignItems: "center", paddingVertical: 30, gap: 12 }}>
                  <View style={s.icon}><Icon name="dollar-sign" size={44} color={colors.amber} /></View>
                  <Text style={type.h2}>Take cash from the customer</Text>
                  <Text style={[type.small, { textAlign: "center", paddingHorizontal: 24 }]}>Count it before you confirm. It is added to your cash in hand, to hand to the store at the end of your shift.</Text>
                </Card>
              </View>
            ) : (
              <View key="upi">
                <Card style={{ alignItems: "center", paddingVertical: 30, gap: 12 }}>
                  <View style={[s.icon, { backgroundColor: colors.blueSoft }]}><Icon name="smartphone" size={44} color={colors.blue} /></View>
                  <Text style={type.h2}>Customer pays by UPI</Text>
                  <Text style={[type.small, { textAlign: "center", paddingHorizontal: 24 }]}>Ask the customer to pay {rupees(o.amountDue)} to the store's UPI and show you the success screen. Your manager will check it against the bank, so it is not counted as cash.</Text>
                </Card>
              </View>
            )}
          </View>
        </>
      )}
      {failure ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, textAlign: "center", marginVertical: 10 }}>{failure}</Text> : null}
      <Stagger i={3} style={{ marginTop: 28 }}><SwipeButton label={paid ? "Slide: delivered" : method === "cash" ? "Slide: cash collected" : "Slide: UPI received"} icon="check" tone="green" resetKey={resetKey} onConfirm={() => void done()} /></Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  amountWrap: { alignItems: "center", marginTop: 10, marginBottom: 22, gap: 6 },
  amount: { fontSize: 58, fontWeight: "900", color: colors.maroon, letterSpacing: -2 },
  seg: { flexDirection: "row", backgroundColor: colors.creamDeep, borderRadius: radius.pill, padding: 4, height: 54 },
  segKnob: { position: "absolute", left: 4, top: 4, bottom: 4, borderRadius: radius.pill, backgroundColor: colors.maroon, ...shadow.card },
  segItem: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontWeight: "800", fontSize: 15, color: colors.muted },
  icon: { width: 96, height: 96, borderRadius: 32, backgroundColor: colors.amberSoft, alignItems: "center", justifyContent: "center" },
  paid: { backgroundColor: colors.red, borderRadius: radius.xl, padding: 28, alignItems: "center", gap: 10, marginVertical: 24 },
  paidTitle: { color: colors.white, fontSize: 28, fontWeight: "900" },
  paidText: { color: colors.white, fontWeight: "700", textAlign: "center" },
});
