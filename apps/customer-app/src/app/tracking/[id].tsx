import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getOrderGroup, getTracking, isActiveStatus, pollMs, STEPS, stepTimes, trackingHeadline, type OrderGroup, type Tracking } from "../../api/orders";
import { TrackMap } from "../../components/TrackMap";
import { Button, goBack, Icon, Press } from "../../components/ui";
import { colors, radius, shadow, space, type } from "../../theme";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const ago = (iso: string, now: number) => {
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return sec < 45 ? "just now" : sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min ago` : `${Math.round(sec / 3600)} h ago`;
};

/** Screen 28: live tracking of one delivery. The map, an ETA pill, the rider, and the delivery code. Polls the server (no sockets). */
export default function TrackingScreen() {
  const { id, group: groupId } = useLocalSearchParams<{ id: string; group?: string }>();
  const insets = useSafeAreaInsets();
  const [t, setT] = useState<Tracking | null>(null);
  const [g, setG] = useState<OrderGroup | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const statusRef = useRef("PLACED");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);

  useEffect(() => { if (groupId) void getOrderGroup(groupId).then(setG).catch(() => undefined); }, [groupId]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(i); }, []);

  const poll = useCallback(async () => {
    if (!active.current) return;
    try {
      const r = await getTracking(id);
      setT(r); setFailed(false); statusRef.current = r.status;
      if (!isActiveStatus(r.status)) return; // delivered or cancelled: stop asking
    } catch { setFailed(true); } // keep the last answer and show how old it is
    timer.current = setTimeout(() => void poll(), pollMs(statusRef.current));
  }, [id]);

  // Poll only while this screen is in front and the app is open.
  useFocusEffect(useCallback(() => {
    active.current = true; void poll();
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") { active.current = true; if (timer.current) clearTimeout(timer.current); void poll(); }
      else { active.current = false; if (timer.current) clearTimeout(timer.current); }
    });
    return () => { active.current = false; if (timer.current) clearTimeout(timer.current); sub.remove(); };
  }, [poll]));

  const head = trackingHeadline(t?.status ?? "PLACED");
  const live = t ? isActiveStatus(t.status) : true;
  const riderPos = t?.rider?.location ?? null;
  const dest = g?.address as unknown as { location?: { lat: number; lng: number } } | undefined;
  const door = dest?.location ?? null;

  const etaText = !t ? "Loading…" : !live ? head.title
    : t.eta.liveEtaMinutes != null ? (t.eta.liveEtaMinutes <= 0 ? "Arriving now" : `Arriving in ${t.eta.liveEtaMinutes} min`)
    : t.eta.promisedAt ? `Arriving by ${clock(t.eta.promisedAt)}` : "On its way";
  const stamp = t?.rider?.lastLocationAt ?? t?.eta.updatedAt ?? null;
  const stale = stamp ? now - new Date(stamp).getTime() > 120_000 : false;

  const reached = t ? stepTimes(t.timeline).reduce((n, x, i) => (x ? i : n), -1) : -1;
  const others = t ? t.group.children.filter(c => c.id !== t.orderId) : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      {door ? <TrackMap destination={door} rider={riderPos ? { lat: riderPos.lat, lng: riderPos.lng } : null} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.creamDeep }]} />}

      {/* Top: back button and the ETA pill */}
      <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Press onPress={goBack} haptic style={s.back}><Icon name="arrow-left" size={20} /></Press>
        <View style={s.eta}>
          <Text style={s.etaText}>{etaText}</Text>
          {live && stamp && <Text style={[s.etaSub, stale && { color: colors.red }]}>{riderPos ? "Location updated" : "Updated"} {ago(stamp, now)}</Text>}
        </View>
      </View>

      {/* Bottom card */}
      <View style={[s.sheet, { paddingBottom: insets.bottom + space.md, maxHeight: "62%" }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
          <View>
            <Text style={s.title}>{head.title}</Text>
            {head.sub ? <Text style={type.small}>{head.sub}</Text> : null}
            {failed && <Text style={[type.small, { color: colors.amber, marginTop: 4 }]}>Can't refresh right now. Showing the last update.</Text>}
          </View>

          {/* Progress */}
          <View style={{ flexDirection: "row", gap: 6 }}>
            {STEPS.map((st, i) => <View key={st.key} style={[s.seg, i <= reached && { backgroundColor: t && (t.status === "CANCELLED" || t.status === "FAILED_DELIVERY") ? colors.red : colors.green }]} />)}
          </View>

          {/* Delivery code */}
          {t?.deliveryOtp && live && (
            <View style={s.code}>
              <View style={{ flex: 1 }}><Text style={type.label}>Delivery code</Text><Text style={type.small}>Tell this to your delivery partner.</Text></View>
              <Text style={s.otp}>{t.deliveryOtp}</Text>
            </View>
          )}

          {/* Rider */}
          {t?.rider && live && (
            <View style={s.rider}>
              <View style={s.avatar}><Icon name="user" size={20} color={colors.maroon} /></View>
              <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{t.rider.name}</Text><Text style={type.small}>Your delivery partner</Text></View>
              <Press onPress={() => void Linking.openURL(`tel:${t.rider!.phone}`)} haptic style={s.call}><Icon name="phone" size={18} color={colors.white} /></Press>
            </View>
          )}

          {/* Other deliveries of a split order */}
          {others.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={type.label}>Other deliveries in this order</Text>
              {others.map(c => (
                <Press key={c.id} onPress={() => router.replace({ pathname: "/tracking/[id]", params: { id: c.id, group: groupId ?? "" } })}>
                  <View style={s.other}><Text style={[type.body, { flex: 1 }]}>{c.orderNo}</Text><Text style={type.small}>{trackingHeadline(c.status).title}</Text><Icon name="chevron-right" size={16} color={colors.faint} /></View>
                </Press>
              ))}
            </View>
          )}

          <View style={{ flexDirection: "row", gap: space.sm }}>
            {g && (g as unknown as { trackingUrl?: string }).trackingUrl && (
              <Button label="Share link" variant="soft" icon="share-2" onPress={() => void Share.share({ message: `Track my Darjeeling Stores order: ${(g as unknown as { trackingUrl: string }).trackingUrl}` })} style={{ flex: 1 }} />
            )}
            {groupId ? <Button label="Order details" variant="ghost" onPress={() => router.replace({ pathname: "/order/[id]", params: { id: groupId } })} style={{ flex: 1 }} /> : null}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: space.lg, flexDirection: "row", alignItems: "flex-start", gap: space.md },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow.card },
  eta: { flex: 1, backgroundColor: colors.maroon, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: 10, ...shadow.lift },
  etaText: { color: colors.white, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  etaSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 1 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, ...shadow.lift },
  title: { fontSize: 20, fontWeight: "900", color: colors.ink, letterSpacing: -0.4 },
  seg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.line },
  code: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.yellowSoft, borderRadius: radius.md, padding: space.md },
  otp: { fontSize: 28, fontWeight: "900", letterSpacing: 6, color: colors.maroon },
  rider: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.cream, borderRadius: radius.md, padding: space.md },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  call: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  other: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 8 },
});
