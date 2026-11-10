import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInDown } from "react-native-reanimated";
import { arrived, stageOf, startRide } from "../../api/rider";
import { RideMap } from "../../components/RideMap";
import { OrderGate } from "../../components/OrderGate";
import { SwipeButton } from "../../components/SwipeButton";
import { Icon, Press, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { currentFix, isCod, useOrderDetail } from "../../state/useOrderDetail";
import { colors, radius, rupees, shadow, type } from "../../theme";

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

/** Ride screen: an illustrated route on top (real navigation is "Open Google Maps") and a sheet with the next action. */
export default function Ride() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refreshOrders } = useStore();
  const { detail: o, error, loading, reload } = useOrderDetail(id);
  const [failure, setFailure] = useState("");
  const [resetKey, setResetKey] = useState(0);
  if (!o) return <OrderGate title="Ride" loading={loading} error={error} onRetry={() => void reload()} />;

  const stage = stageOf(o.status);
  const riding = stage === "out_for_delivery";
  const fail = (e: unknown, fallback: string) => { setFailure(e instanceof Error ? e.message : fallback); setResetKey(k => k + 1); };

  async function begin() {
    setFailure("");
    try { await startRide(o!.id); await reload(); void refreshOrders().catch(() => undefined); setResetKey(k => k + 1); }
    catch (e) { fail(e, "Could not start the ride."); }
  }
  async function reach() {
    setFailure("");
    try {
      const fix = await currentFix();
      await arrived(o!.id, fix?.location ?? null);
      void refreshOrders().catch(() => undefined);
      router.replace({ pathname: "/order/arrived", params: { id: o!.id } });
    } catch (e) { fail(e, "Could not mark you as arrived."); }
  }
  const mapsQuery = o.address.location ? `${o.address.location.lat},${o.address.location.lng}` : encodeURIComponent(`${o.address.line1}, ${o.address.locality}`);

  return (
    <Screen pad={false} bottomPad={0} style={{ backgroundColor: "#efe9da" }}>
      <View style={{ flex: 1 }}>
        <View style={s.mapWrap}><RideMap height={520} warehouse={o.warehouse.location} destination={o.address.location} moving={riding} /></View>
        <View style={s.topBar}>
          <Press haptic onPress={() => router.back()} style={s.round}><Icon name="arrow-left" /></Press>
          <View style={s.chip}><Icon name="navigation" size={14} color={colors.maroon} /><Text style={s.chipText}>{riding ? "Heading to customer" : stage === "arrived" ? "You have arrived" : "Start the ride when ready"}</Text></View>
        </View>
      </View>

      <Animated.View entering={SlideInDown.duration(380)} style={s.sheet}>
        <View style={s.grab} />
        <View style={s.stats}>
          <View style={s.stat}><Text style={s.big}>{hhmm(o.promisedAt)}</Text><Text style={type.small}>Promised by</Text></View>
          <View style={s.sep} />
          <View style={s.stat}><Text style={s.big}>{o.items.reduce((a, i) => a + i.qty, 0)}</Text><Text style={type.small}>Items</Text></View>
          <View style={s.sep} />
          <View style={s.stat}><Text style={s.big}>{isCod(o) ? rupees(o.amountDue) : "Paid"}</Text><Text style={type.small}>{isCod(o) ? "Collect" : "Payment"}</Text></View>
        </View>
        <View style={s.dest}>
          <View style={s.pin}><Icon name="map-pin" size={20} color={colors.white} /></View>
          <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{o.customer.name}</Text><Text style={type.small} numberOfLines={2}>{o.address.landmark ?? `${o.address.line1}, ${o.address.locality}`}</Text></View>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Press haptic style={s.action} onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`)}><Icon name="map" size={18} color={colors.maroon} /><Text style={s.actionText}>Open Google Maps</Text></Press>
          <Press haptic style={[s.action, { flex: 0, width: 56, backgroundColor: colors.greenSoft }]} onPress={() => void Linking.openURL(`tel:${o.customer.phone.replace(/\s/g, "")}`)}><Icon name="phone" size={20} color={colors.green} /></Press>
        </View>
        {failure ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, textAlign: "center" }}>{failure}</Text> : null}
        {stage === "arrived"
          ? <SwipeButton label="Slide to enter delivery code" icon="lock" tone="green" resetKey={resetKey} onConfirm={() => router.replace({ pathname: "/order/arrived", params: { id: o.id } })} />
          : riding
            ? <SwipeButton label="Slide when you arrive" icon="map-pin" tone="green" resetKey={resetKey} onConfirm={() => void reach()} />
            : <SwipeButton label="Slide to start ride" icon="navigation" resetKey={resetKey} onConfirm={() => void begin()} />}
      </Animated.View>
    </Screen>
  );
}

const s = StyleSheet.create({
  mapWrap: { position: "absolute", top: 0, left: 0, right: 0 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingTop: 8 },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow.card },
  chip: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.white, height: 40, paddingHorizontal: 14, borderRadius: 20, ...shadow.card },
  chipText: { fontWeight: "800", color: colors.maroon, fontSize: 13 },
  sheet: { backgroundColor: colors.cream, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 22, paddingBottom: 36, gap: 14, ...shadow.lift },
  grab: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line },
  stats: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", marginVertical: 2 },
  stat: { alignItems: "center" },
  sep: { width: 1, height: 34, backgroundColor: colors.line },
  big: { fontSize: 22, fontWeight: "900", color: colors.ink, letterSpacing: -0.6 },
  dest: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.white, borderRadius: radius.lg, padding: 14 },
  pin: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  action: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.yellowSoft, height: 52, borderRadius: radius.lg },
  actionText: { fontWeight: "800", color: colors.maroon },
});
