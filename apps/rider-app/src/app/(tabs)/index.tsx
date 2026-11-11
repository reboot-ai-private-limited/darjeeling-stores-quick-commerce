import { LinearGradient } from "expo-linear-gradient";
import { liftIn } from "../../motion";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, LinearTransition, useAnimatedStyle } from "react-native-reanimated";
import { stageOf, type Stage } from "../../api/rider";
import { PulseRings, useCountUp } from "../../components/effects";
import { Button, Card, Icon, Press, Screen, SectionTitle, Stagger } from "../../components/ui";
import { smooth } from "../../motion";
import { useStore } from "../../state/store";
import { colors, radius, rupees, shadow, type } from "../../theme";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const clock = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); const f = (n: number) => String(n).padStart(2, "0"); return `${f(Math.floor(t / 3600))}:${f(Math.floor((t % 3600) / 60))}:${f(t % 60)}`; };
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : null);
const STAGE_LABEL: Record<Stage, string> = { assigned: "Go to the store", picked_up: "Start your ride", out_for_delivery: "On the way", arrived: "Enter delivery code", delivered: "Delivered", failed: "Failed" };
const STAGE_NEXT: Record<Stage, string> = { assigned: "/order/pickup", picked_up: "/order/ride", out_for_delivery: "/order/ride", arrived: "/order/arrived", delivered: "/", failed: "/" };

function Stat({ icon, label, value, i, tint }: { icon: React.ComponentProps<typeof Icon>["name"]; label: string; value: string; i: number; tint: string }) {
  return (
    <Stagger i={i} style={{ flex: 1 }}>
      <Card style={{ padding: 14 }}>
        <View style={[s.statIcon, { backgroundColor: tint }]}><Icon name={icon} size={18} color={colors.maroon} /></View>
        <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={type.small}>{label}</Text>
      </Card>
    </Stagger>
  );
}

export default function Home() {
  const { shift, toggleBreak, deliveredToday, cashInHand, pendingSync, active, orders, me, refreshOrders, warehouses, switchStore } = useStore();
  const [picking, setPicking] = useState(false);
  async function chooseStore(id: string) {
    setPicking(false);
    if (id === shift.warehouse?.id) return;
    setBreakError("");
    try { await switchStore(id); } catch (e) { setBreakError(e instanceof Error ? e.message : "Could not switch store."); }
  }
  const [breakBusy, setBreakBusy] = useState(false);
  const [breakError, setBreakError] = useState("");
  async function flipBreak() {
    if (breakBusy) return;
    setBreakBusy(true); setBreakError("");
    try { await toggleBreak(); } catch (e) { setBreakError(e instanceof Error ? e.message : "Could not change your status."); } finally { setBreakBusy(false); }
  }
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { void refreshOrders().catch(() => undefined); }, [refreshOrders]);
  const delivered = useCountUp(deliveredToday);
  const cash = useCountUp(cashInHand / 100, 1100);
  const onBreak = shift.onBreak;
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: smooth(onBreak ? 0 : 62) }] }), [onBreak]);
  const stage = active ? stageOf(active.status) : null;
  const promised = active ? hhmm(active.promisedAt) : null;

  return (
    <Screen scroll pad={false} bottomPad={120}>
      <LinearGradient colors={[colors.maroon, colors.maroonSoft]} style={s.hero}>
        <View style={s.heroDot} />
        <Stagger i={0} style={s.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.hello}>{greeting()},</Text>
            <Text style={s.name}>{(me?.name ?? "Rider").split(" ")[0]} 👋</Text>
          </View>
          <Press onPress={() => router.push("/problem")} haptic style={s.sos}><Icon name="alert-circle" size={22} color={colors.white} /></Press>
        </Stagger>
        <Stagger i={1}>
          <View style={s.shiftCard}>
            <View style={{ flex: 1 }}>
              <Press onPress={() => warehouses.length > 1 && setPicking(p => !p)} haptic scaleTo={0.98}><Text style={s.shiftLabel}>{onBreak ? "ON BREAK" : "ON SHIFT"} · {shift.warehouse?.name}{warehouses.length > 1 ? "  ▾" : ""}</Text></Press>
              <Text style={s.timer}>{clock(now - (shift.startedAt ?? now))}</Text>
            </View>
            <Press onPress={() => void flipBreak()} haptic style={[s.toggle, { backgroundColor: onBreak ? colors.amberSoft : colors.greenSoft }]}>
              <Animated.View style={[s.toggleKnob, { backgroundColor: onBreak ? colors.amber : colors.green }, knob]} />
              <Text style={[s.toggleText, { color: onBreak ? colors.amber : colors.green, marginLeft: onBreak ? 40 : 14 }]}>{onBreak ? "Break" : "Online"}</Text>
            </Press>
          </View>
        </Stagger>
      </LinearGradient>

      <View style={{ paddingHorizontal: 24 }}>
        {picking && (
          <Card style={{ marginTop: 52, gap: 4 }}>{warehouses.map(w => (
            <Press key={w.id} onPress={() => void chooseStore(w.id)} haptic style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10 }}>
              <Icon name={w.id === shift.warehouse?.id ? "check-circle" : "home"} size={18} color={w.id === shift.warehouse?.id ? colors.green : colors.maroon} /><Text style={[type.body, { fontWeight: "800" }]}>{w.name}</Text>
            </Press>
          ))}</Card>
        )}
        {breakError ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 10 }}>{breakError}</Text> : null}
        <View style={s.stats}>
          <Stat i={2} icon="check-circle" label="Delivered today" value={String(delivered)} tint={colors.greenSoft} />
          <Stat i={3} icon="credit-card" label="Cash in hand" value={`₹${cash.toLocaleString("en-IN")}`} tint={colors.yellowSoft} />
          <Stat i={4} icon="refresh-cw" label="To sync" value={String(pendingSync)} tint={colors.blueSoft} />
        </View>

        <SectionTitle>{active ? "Current delivery" : "Your queue"}</SectionTitle>
        {active && stage ? (
          <Animated.View entering={liftIn(0)} layout={LinearTransition.duration(260)}>
            <Press onPress={() => router.push({ pathname: "/order/[id]", params: { id: active.id } })} haptic style={s.activeCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={s.activeIcon}><Icon name="package" size={24} color={colors.maroon} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.activeNo}>{active.orderNo}</Text>
                  <Text style={s.activeSub}>{active.customerName} · {active.locality} · {active.itemCount} {active.itemCount === 1 ? "item" : "items"}</Text>
                </View>
                <Icon name="chevron-right" color={colors.white} />
              </View>
              <View style={s.activeFoot}>
                <Text style={s.activeStage}>{STAGE_LABEL[stage]}</Text>
                <Text style={s.activeCod}>{active.alreadyPaid || active.amountDue === 0 ? "Prepaid" : `Collect ${rupees(active.amountDue)}`}{promised ? ` · by ${promised}` : ""}</Text>
              </View>
            </Press>
            <View style={{ marginTop: 14 }}><Button label={STAGE_LABEL[stage]} icon="arrow-right" variant="accent" onPress={() => router.push({ pathname: STAGE_NEXT[stage], params: { id: active.id } } as never)} /></View>
            {orders.length > 1 && <Text style={[type.small, { textAlign: "center", marginTop: 12 }]}>{orders.length - 1} more waiting in your queue</Text>}
          </Animated.View>
        ) : (
          <Stagger i={5}>
            <Card style={s.empty}>
              <PulseRings size={54}><View style={s.radar}><Icon name={onBreak ? "coffee" : "radio"} size={26} color={colors.maroon} /></View></PulseRings>
              <Text style={[type.h2, { marginTop: -34 }]}>{onBreak ? "Enjoy your break" : "Waiting for orders"}</Text>
              <Text style={[type.small, { textAlign: "center", marginTop: 6 }]}>{onBreak ? "You won't get new deliveries until you're back online." : "Stay close to the store. New deliveries will ring here."}</Text>
            </Card>
          </Stagger>
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 56, borderBottomLeftRadius: 38, borderBottomRightRadius: 38, overflow: "hidden" },
  heroDot: { position: "absolute", width: 240, height: 240, borderRadius: 120, backgroundColor: "rgba(255,201,51,0.10)", top: -80, right: -70 },
  heroTop: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  hello: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "600" },
  name: { color: colors.white, fontSize: 28, fontWeight: "900", letterSpacing: -0.6 },
  sos: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  shiftCard: { flexDirection: "row", alignItems: "center", marginTop: 20, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.lg, padding: 16 },
  shiftLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  timer: { color: colors.white, fontSize: 30, fontWeight: "800", marginTop: 2, fontVariant: ["tabular-nums"] },
  toggle: { width: 100, height: 38, borderRadius: 19, justifyContent: "center" },
  toggleKnob: { position: "absolute", left: 5, top: 5, width: 28, height: 28, borderRadius: 14 },
  toggleText: { fontSize: 13, fontWeight: "800" },
  stats: { flexDirection: "row", gap: 10, marginTop: -34 },
  statIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  statValue: { fontSize: 20, fontWeight: "900", color: colors.ink, letterSpacing: -0.5 },
  activeCard: { backgroundColor: colors.maroon, borderRadius: radius.xl, padding: 18, ...shadow.lift },
  activeIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  activeNo: { color: colors.white, fontSize: 19, fontWeight: "900" },
  activeSub: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 2, fontWeight: "600" },
  activeFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.14)" },
  activeStage: { color: colors.yellow, fontWeight: "800", fontSize: 14 },
  activeCod: { color: colors.white, fontWeight: "800", fontSize: 13 },
  empty: { alignItems: "center", paddingVertical: 20, overflow: "hidden" },
  radar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
});
