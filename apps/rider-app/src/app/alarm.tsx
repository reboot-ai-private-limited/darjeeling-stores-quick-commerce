import { useAudioPlayer } from "expo-audio";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, Vibration, View } from "react-native";
import Animated, { Easing, FadeInDown, SlideInDown, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { ackAssignment } from "../api/rider";
import { PulseRings } from "../components/effects";
import { SwipeButton } from "../components/SwipeButton";
import { Icon, Press } from "../components/ui";
import { useStore } from "../state/store";
import { colors, radius, rupees } from "../theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const R = 26;
const C = 2 * Math.PI * R;
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

/**
 * Full-screen assignment alarm: rings expand behind the bell, the phone vibrates in a loop, and a countdown ring drains
 * until the server's acceptance deadline. There is deliberately no reject button: the rider slides to accept.
 */
export default function Alarm() {
  const { ringing, refreshOrders } = useStore();
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const order = ringing?.orders[0];

  const deadline = ringing?.ackDeadlineAt ? Date.parse(ringing.ackDeadlineAt) : null;
  const total = deadline && ringing ? Math.max(1, Math.round((deadline - Date.parse(ringing.assignedAt)) / 1000)) : 120;
  const [left, setLeft] = useState(deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : total);
  const drain = useSharedValue(0);
  const ring = useAnimatedProps(() => ({ strokeDashoffset: C * drain.value }));

  // A looping two-tone ring while this screen is open (the file is generated into assets/sounds, no download needed).
  const sound = useAudioPlayer(require("../../assets/sounds/alarm.wav"));
  useEffect(() => {
    try { sound.loop = true; sound.volume = 1; sound.play(); } catch { /* sound is a bonus; vibration still works */ }
    return () => { try { sound.pause(); } catch { /* already released */ } };
  }, [sound]);

  useEffect(() => {
    Vibration.vibrate([0, 600, 400], true);
    const remaining = deadline ? Math.max(0, deadline - Date.now()) : total * 1000;
    drain.value = withTiming(1, { duration: Math.max(1, remaining), easing: Easing.linear });
    const t = setInterval(() => setLeft(deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : l => Math.max(0, l - 1)), 1000);
    return () => { Vibration.cancel(); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringing?.id]);

  // If the assignment is accepted elsewhere, cancelled or taken away, there is nothing left to ring for.
  useEffect(() => { if (!ringing) router.replace("/(tabs)"); }, [ringing]);
  if (!ringing || !order) return null;

  async function accept() {
    if (!ringing) return;
    setError("");
    try {
      await ackAssignment(ringing.id);
      Vibration.cancel();
      await refreshOrders().catch(() => undefined);
      router.replace({ pathname: "/order/[id]", params: { id: order!.id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not accept this delivery."); setResetKey(k => k + 1); }
  }

  const items = ringing.orders.reduce((a, o) => a + o.itemCount, 0);
  const due = ringing.orders.reduce((a, o) => a + (o.paymentStatus.startsWith("cod") ? o.amountDue : 0), 0);

  return (
    <LinearGradient colors={[colors.maroonDeep, colors.maroon, "#7a2a23"]} style={s.fill}>
      <View style={s.top}>
        <Animated.View entering={FadeInDown.duration(350)} style={s.timer}>
          <Svg width={64} height={64} viewBox="0 0 64 64" style={{ transform: [{ rotate: "-90deg" }] }}>
            <Circle cx={32} cy={32} r={R} stroke="rgba(255,255,255,0.18)" strokeWidth={5} fill="none" />
            <AnimatedCircle cx={32} cy={32} r={R} stroke={colors.yellow} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray={C} animatedProps={ring} />
          </Svg>
          <Text style={s.timerText}>{left}</Text>
        </Animated.View>
      </View>

      <View style={s.center}>
        <PulseRings size={110}>
          <View style={s.bell}><Icon name="bell" size={52} color={colors.maroon} /></View>
        </PulseRings>
        <Animated.Text entering={FadeInDown.delay(200).duration(350)} style={s.title}>New delivery!</Animated.Text>
        <Animated.Text entering={FadeInDown.delay(300).duration(350)} style={s.sub}>{ringing.orders.map(o => o.orderNo).join(" + ")} · {order.warehouse.name}</Animated.Text>
      </View>

      <Animated.View entering={SlideInDown.delay(350).duration(380)} style={s.sheet}>
        <View style={s.facts}>
          <Fact icon="map-pin" value={order.locality} label="Deliver to" />
          <Fact icon="shopping-bag" value={`${items} ${items === 1 ? "item" : "items"}`} label="To carry" />
          <Fact icon="clock" value={hhmm(order.promisedAt)} label="Promised by" />
          <Fact icon="credit-card" value={due > 0 ? rupees(due) : "Prepaid"} label={due > 0 ? "Collect" : "Payment"} />
        </View>
        {error ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, textAlign: "center" }}>{error}</Text> : null}
        <SwipeButton label="Slide to accept" icon="check" tone="green" resetKey={resetKey} onConfirm={() => void accept()} />
        <Press onPress={() => router.push("/problem")} haptic style={s.problem}><Icon name="alert-circle" size={16} color={colors.muted} /><Text style={s.problemText}>Report a problem</Text></Press>
      </Animated.View>
    </LinearGradient>
  );
}

function Fact({ icon, value, label }: { icon: React.ComponentProps<typeof Icon>["name"]; value: string; label: string }) {
  return <View style={s.fact}><Icon name={icon} size={18} color={colors.maroon} /><Text style={s.factValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={s.factLabel}>{label}</Text></View>;
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  top: { paddingTop: 54, alignItems: "center" },
  timer: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  timerText: { position: "absolute", color: colors.white, fontWeight: "900", fontSize: 18 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  bell: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  title: { color: colors.white, fontSize: 34, fontWeight: "900", letterSpacing: -1, marginTop: -30 },
  sub: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: "700", marginTop: 6, textAlign: "center", paddingHorizontal: 24 },
  sheet: { backgroundColor: colors.cream, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 22, paddingBottom: 34, gap: 16 },
  facts: { flexDirection: "row", gap: 8 },
  fact: { flex: 1, backgroundColor: colors.white, borderRadius: radius.md, padding: 10, alignItems: "center", gap: 4 },
  factValue: { fontSize: 14, fontWeight: "900", color: colors.ink },
  factLabel: { fontSize: 10.5, fontWeight: "700", color: colors.muted },
  problem: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", padding: 8 },
  problemText: { color: colors.muted, fontWeight: "800", fontSize: 13 },
});
