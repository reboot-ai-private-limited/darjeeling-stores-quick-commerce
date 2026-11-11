import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getOrderGroup, isActiveStatus, reorder, statusInfo, STEPS, stepTimes, trackingHeadline, type ChildOrder, type OrderGroup } from "../../api/orders";
import { Button, Header, Icon, Press, Screen, type IconName } from "../../components/ui";
import { useCart } from "../../state/cart";
import { colors, radius, rupees, shadow, space, type } from "../../theme";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const PAYMENT: Record<string, string> = {
  cod_pending: "Pay on delivery", cod_collected: "Paid in cash", paid: "Paid online", pending: "Payment pending", failed: "Payment failed", upi_unverified: "UPI payment being verified",
};
const SHORT = ["Placed", "Confirmed", "Packing", "On the way", "Delivered"];
const CANCELLABLE = ["PENDING_PAYMENT", "PLACED", "CONFIRMED"];
const TONE_ICON: Record<string, { icon: IconName; fg: string; bg: string }> = {
  green: { icon: "check-circle", fg: colors.green, bg: colors.greenSoft }, amber: { icon: "clock", fg: colors.amber, bg: colors.amberSoft },
  red: { icon: "x-circle", fg: colors.red, bg: colors.redSoft }, blue: { icon: "package", fg: colors.blue, bg: colors.blueSoft }, maroon: { icon: "package", fg: colors.maroon, bg: colors.creamDeep },
};

/** Screen 27: one order. Status first, then items, bill, delivery and payment, with the actions (track, reorder, cancel, report a problem) in clear places. */
export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setFromServer } = useCart();
  const insets = useSafeAreaInsets();
  const [g, setG] = useState<OrderGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setG(await getOrderGroup(id)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load this order."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const live = !!g && g.children.some(c => isActiveStatus(c.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [live, load]);

  const doReorder = async (c: ChildOrder) => {
    setBusy(true); setNote(null);
    try {
      const r = await reorder(c.id);
      setFromServer(r.cart.items);
      if (r.corrections.length) setNote("Some items are out of stock or limited, so your cart was adjusted.");
      router.push("/cart");
    } catch (e) { setNote(e instanceof Error ? e.message : "Couldn't add these items to your cart."); }
    finally { setBusy(false); }
  };

  if (error && !g) return <Screen><Header title="Order" /><View style={s.center}><Icon name="wifi-off" size={36} color={colors.faint} /><Text style={type.small}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} /></View></Screen>;
  if (!g) return <Screen><Header title="Order" /><ActivityIndicator color={colors.maroon} style={{ marginTop: 100 }} /></Screen>;

  const a = g.address;
  const multi = g.children.length > 1;
  const liveChild = g.children.find(c => isActiveStatus(c.status));
  const needsPayment = g.status === "PENDING_PAYMENT" && g.paymentMethod === "online";
  const cancellable = g.children.filter(c => CANCELLABLE.includes(c.status));
  const reportable = g.children.filter(c => c.status === "DELIVERED");

  // The one main action for this order, pinned at the bottom.
  const primary = needsPayment
    ? <Button label="Pay now" icon="credit-card" onPress={() => router.push({ pathname: "/pay/[id]", params: { id: g.id } })} />
    : liveChild
      ? <Button label="Track order" icon="navigation" onPress={() => router.push({ pathname: "/tracking/[id]", params: { id: liveChild.id, group: g.id } })} />
      : <Button label={busy ? "Adding…" : "Reorder"} icon="rotate-ccw" disabled={busy} onPress={() => void doReorder(g.children[0]!)} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}>
          <Header title={g.groupNo} subtitle={new Date(g.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 110 + insets.bottom, gap: space.md }}>
          {g.children.map((c, idx) => <StatusCard key={c.id} c={c} label={multi ? `Delivery ${idx + 1} of ${g.children.length}` : null} />)}

          {g.deliveryOtp && live && (
            <View style={s.otpCard}>
              <View style={{ flex: 1 }}>
                <Text style={type.label}>Delivery code</Text>
                <Text style={type.small}>Tell this to the delivery partner at your door.</Text>
              </View>
              <Text style={s.otp}>{g.deliveryOtp}</Text>
            </View>
          )}

          {g.children.map(c => c.rider && isActiveStatus(c.status) ? (
            <View key={c.id} style={[s.card, { flexDirection: "row", alignItems: "center", gap: space.md }]}>
              <View style={s.avatar}><Icon name="user" size={20} color={colors.maroon} /></View>
              <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{c.rider.name}</Text><Text style={type.small}>Your delivery partner</Text></View>
              <Press onPress={() => void Linking.openURL(`tel:${c.rider!.phone}`)} haptic style={s.call}><Icon name="phone" size={18} color={colors.white} /></Press>
            </View>
          ) : null)}

          {g.children.map(c => (
            <View key={c.id} style={s.card}>
              <Text style={s.cardTitle}>{multi ? `Items · ${c.orderNo}` : "Items"} <Text style={s.muted}>({c.items?.length ?? 0})</Text></Text>
              {c.items?.map((i, k) => (
                <View key={i.variantId + k} style={[s.item, k > 0 && s.itemSep]}>
                  <View style={s.thumb}>{i.imageUrl ? <Image source={{ uri: i.imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : <Icon name="package" size={18} color={colors.faint} />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={2}>{i.name}</Text>
                    <Text style={type.small}>{i.variantLabel} · Qty {i.qty}{i.status === "unavailable" ? <Text style={{ color: colors.red }}> · unavailable</Text> : null}</Text>
                  </View>
                  <Text style={[type.body, { fontWeight: "800" }]}>{rupees(i.lineTotal)}</Text>
                </View>
              ))}
            </View>
          ))}

          <View style={s.card}>
            <Text style={s.cardTitle}>Bill summary</Text>
            <BillRow label="Items total" value={rupees(g.pricing.subtotal)} />
            {g.pricing.discount > 0 && <BillRow label="Discount" value={`- ${rupees(g.pricing.discount)}`} tone={colors.green} />}
            {g.pricing.charges.map(c => <BillRow key={c.type + c.label} label={c.label} value={c.amount === 0 ? "FREE" : rupees(c.amount)} tone={c.amount === 0 ? colors.green : undefined} />)}
            <View style={s.totalRow}><Text style={s.total}>Total</Text><Text style={s.total}>{rupees(g.pricing.total)}</Text></View>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Delivery and payment</Text>
            <InfoRow icon="map-pin" title={a.contactName} text={[a.line1, a.landmark, a.locality, a.pincode].filter(Boolean).join(", ")} />
            <View style={s.sep} />
            <InfoRow icon="credit-card" title={g.paymentMethod === "cod" ? "Cash on delivery" : "Online payment"} text={PAYMENT[g.paymentStatus] ?? g.paymentStatus.replace(/_/g, " ")} />
          </View>

          {/* Help: cancel and report a problem live here so they're easy to find */}
          <View style={[s.card, { paddingVertical: space.sm }]}>
            <Text style={[s.cardTitle, { marginTop: space.sm }]}>Need help?</Text>
            {cancellable.map(c => (
              <HelpRow key={"x" + c.id} icon="x-circle" label={multi ? `Cancel ${c.orderNo}` : "Cancel order"} sub="Free until the store starts packing" tone={colors.red}
                onPress={() => router.push({ pathname: "/order/cancel", params: { id: c.id, orderNo: c.orderNo } })} />
            ))}
            {reportable.map(c => (
              <HelpRow key={"r" + c.id} icon="alert-circle" label={multi ? `Report a problem · ${c.orderNo}` : "Report a problem"} sub="Missing or damaged item"
                onPress={() => router.push({ pathname: "/order/refund-request", params: { id: c.id, group: g.id } })} />
            ))}
            {cancellable.length === 0 && !g.children.some(c => isActiveStatus(c.status)) && g.children.every(c => !CANCELLABLE.includes(c.status)) && reportable.length === 0 && (
              <Text style={[type.small, { paddingVertical: space.sm }]}>This order can no longer be cancelled.</Text>
            )}
            {cancellable.length === 0 && live && <Text style={[type.small, { paddingVertical: 6 }]}>Packing has started, so this order can't be cancelled now.</Text>}
            <HelpRow icon="help-circle" label="Get help" sub="Call or message us" onPress={() => router.push("/help")} />
          </View>

          {note && <Text style={[type.small, { textAlign: "center", color: colors.amber }]}>{note}</Text>}
        </ScrollView>
      </Screen>
      <View style={[s.bar, { paddingBottom: insets.bottom + space.md }]}>{primary}</View>
    </View>
  );
}

/** The order's status at a glance: a headline, when it arrives and a five-step progress strip. */
function StatusCard({ c, label }: { c: ChildOrder; label: string | null }) {
  const info = statusInfo(c.status);
  const head = trackingHeadline(c.status);
  const tone = TONE_ICON[info.tone] ?? TONE_ICON.maroon!;
  const times = stepTimes(c.timeline);
  const reached = times.reduce((n, t, i) => (t ? i : n), -1);
  const ended = c.status === "CANCELLED" || c.status === "FAILED_DELIVERY";
  const live = isActiveStatus(c.status);
  return (
    <View style={s.card}>
      {label && <Text style={[type.label, { marginBottom: 6 }]}>{label} · {c.orderNo}</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={[s.statusIcon, { backgroundColor: tone.bg }]}><Icon name={tone.icon} size={24} color={tone.fg} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.statusTitle}>{head.title}</Text>
          {live && c.promisedAt ? <Text style={s.arrive}>Arriving by {clock(c.promisedAt)}</Text> : head.sub ? <Text style={type.small}>{head.sub}</Text> : null}
        </View>
      </View>
      {!ended && (
        <View style={{ flexDirection: "row", marginTop: space.lg }}>
          {STEPS.map((st, i) => {
            const done = i <= reached; const current = i === reached && live;
            return (
              <View key={st.key} style={{ flex: 1, alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch" }}>
                  <View style={[s.seg, { opacity: i === 0 ? 0 : 1 }, i <= reached && { backgroundColor: colors.green }]} />
                  <View style={[s.node, done && { backgroundColor: colors.green, borderColor: colors.green }, current && { backgroundColor: colors.yellow, borderColor: colors.maroon }]}>
                    {done && !current && <Icon name="check" size={10} color={colors.white} />}
                  </View>
                  <View style={[s.seg, { opacity: i === STEPS.length - 1 ? 0 : 1 }, i < reached && { backgroundColor: colors.green }]} />
                </View>
                <Text style={[s.stepLabel, done && { color: colors.ink, fontWeight: "800" }]} numberOfLines={1}>{SHORT[i]}</Text>
                {times[i] && <Text style={s.stepTime}>{clock(times[i]!)}</Text>}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function BillRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}><Text style={type.body}>{label}</Text><Text style={[type.body, { fontWeight: "600", color: tone ?? colors.ink }]}>{value}</Text></View>;
}

function InfoRow({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, paddingVertical: 6 }}>
      <View style={s.infoIcon}><Icon name={icon} size={16} color={colors.maroon} /></View>
      <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "700" }]}>{title}</Text><Text style={type.small}>{text}</Text></View>
    </View>
  );
}

function HelpRow({ icon, label, sub, tone, onPress }: { icon: IconName; label: string; sub: string; tone?: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} haptic style={s.helpRow}>
      <Icon name={icon} size={20} color={tone ?? colors.maroon} />
      <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "700", color: tone ?? colors.ink }]}>{label}</Text><Text style={type.small}>{sub}</Text></View>
      <Icon name="chevron-right" size={18} color={colors.faint} />
    </Press>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  cardTitle: { fontSize: 16, fontWeight: "900", color: colors.ink, marginBottom: 6 },
  muted: { color: colors.muted, fontWeight: "600" },
  statusIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 19, fontWeight: "900", letterSpacing: -0.4, color: colors.ink },
  arrive: { fontSize: 14, fontWeight: "800", color: colors.maroon, marginTop: 2 },
  seg: { flex: 1, height: 3, backgroundColor: colors.line },
  node: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  stepLabel: { fontSize: 10, fontWeight: "600", color: colors.faint, marginTop: 6, textAlign: "center" },
  stepTime: { fontSize: 10, color: colors.muted, marginTop: 1 },
  otpCard: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.yellowSoft, borderRadius: radius.lg, padding: space.lg },
  otp: { fontSize: 28, fontWeight: "900", letterSpacing: 6, color: colors.maroon },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  call: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  itemSep: { borderTopWidth: 1, borderTopColor: colors.line },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: space.md, marginTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  total: { fontSize: 16, fontWeight: "900", color: colors.ink },
  sep: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  infoIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  helpRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.cream, borderTopWidth: 1, borderTopColor: colors.line },
});
