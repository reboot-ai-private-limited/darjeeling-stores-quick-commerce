import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import type { Category } from "../api/catalog";
import { listCoupons, type CouponRow } from "../api/account";
import { listOrders, reorder, statusInfo, STEPS, trackingHeadline, type OrderSummary } from "../api/orders";
import { liftIn } from "../motion";
import { useCart } from "../state/cart";
import { colors, radius, rupees, SECTION_GAP, shadow, space, TITLE_GAP, type } from "../theme";
import { Icon, Press, type IconName } from "./ui";

/** A soft "live" dot: a ring that slowly grows and fades. */
function LiveDot({ color = colors.green }: { color?: string }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false); }, [p]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - p.value), transform: [{ scale: 1 + p.value * 1.4 }] }));
  return (
    <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: 10, height: 10, borderRadius: 5, backgroundColor: color }, ring]} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null);

/** Where your order is right now. Shows only while something is on its way, refreshes by itself, and opens live tracking. */
export function LiveOrderCard({ signedIn }: { signedIn: boolean }) {
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const load = useCallback(() => { if (signedIn) void listOrders("active").then(r => setOrder(r.items[0] ?? null)).catch(() => undefined); else setOrder(null); }, [signedIn]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  if (!order) return null;
  const child = order.children[0];
  const head = trackingHeadline(child?.status ?? order.status);
  const idx = Math.max(0, STEPS.findIndex(st => st.match.includes(child?.status ?? "")));
  const by = clock(child?.promisedAt);
  return (
    <Animated.View entering={liftIn(0, 16)} style={{ marginHorizontal: space.lg, marginTop: space.lg }}>
      <Press haptic onPress={() => (child ? router.push({ pathname: "/tracking/[id]", params: { id: child.id, group: order.groupId } }) : router.push({ pathname: "/order/[id]", params: { id: order.groupId } }))} style={s.live}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <LiveDot color={colors.yellow} />
          <Text style={s.liveTag}>{statusInfo(child?.status ?? order.status).label.toUpperCase()}</Text>
          <View style={{ flex: 1 }} />
          {by && <Text style={s.liveBy}>by {by}</Text>}
        </View>
        <Text style={s.liveTitle}>{head.title}</Text>
        <View style={s.track}>{STEPS.map((st, k) => <View key={st.key} style={[s.seg, k <= idx && { backgroundColor: colors.yellow }]} />)}</View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={s.liveSub}>{order.groupNo ?? ""} · Track order</Text><Icon name="arrow-right" size={14} color={colors.yellow} />
        </View>
      </Press>
    </Animated.View>
  );
}

const OFFER_TINTS: [string, string][] = [["#fff4d1", "#d98a00"], ["#e2f5ec", "#1f9d62"], ["#fde8e6", "#c62828"], ["#e5eefc", "#2f6fdb"]];

/** Ticket-style coupon cards. Tapping one opens the coupon screen to apply it. */
export function OffersRow({ zoneId, signedIn }: { zoneId?: string; signedIn: boolean }) {
  const { subtotal } = useCart();
  const [rows, setRows] = useState<CouponRow[]>([]);
  useEffect(() => { if (signedIn && zoneId) void listCoupons(zoneId, subtotal).then(r => setRows(r.filter(c => c.applicable).slice(0, 8))).catch(() => setRows([])); else setRows([]); }, [signedIn, zoneId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (rows.length === 0) return null;
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <View style={s.head}><Text style={s.title}>Offers for you</Text><Press onPress={() => router.push("/coupons")}><Text style={s.link}>View all</Text></Press></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: TITLE_GAP, gap: space.md }}>
        {rows.map((c, i) => {
          const [bg, fg] = OFFER_TINTS[i % OFFER_TINTS.length];
          return (
            <Animated.View key={c.code} entering={liftIn(i * 60)}>
              <Press haptic onPress={() => router.push("/coupons")} style={[s.offer, { backgroundColor: bg }]}>
                <View style={[s.offerIcon, { backgroundColor: fg }]}><Icon name="percent" size={16} color={colors.white} /></View>
                <Text style={[s.offerDesc, { color: colors.ink }]} numberOfLines={2}>{c.description}</Text>
                <View style={[s.code, { borderColor: fg }]}><Text style={[s.codeText, { color: fg }]}>{c.code}</Text></View>
                {c.minOrder > 0 && <Text style={s.offerMin}>Above {rupees(c.minOrder)}</Text>}
              </Press>
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** One-tap reorder of the last delivered order. */
export function OrderAgainCard({ signedIn }: { signedIn: boolean }) {
  const { setFromServer } = useCart();
  const [last, setLast] = useState<OrderSummary | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (signedIn) void listOrders("past").then(r => setLast(r.items.find(o => o.status === "DELIVERED") ?? null)).catch(() => setLast(null)); else setLast(null); }, [signedIn]);
  if (!last || !last.children[0]) return null;
  const items = last.children.reduce((n, c) => n + c.itemCount, 0);
  const go = async () => {
    setBusy(true);
    try { const r = await reorder(last.children[0].id); setFromServer(r.cart.items); router.push("/cart"); } catch { router.push({ pathname: "/order/[id]", params: { id: last.groupId } }); } finally { setBusy(false); }
  };
  return (
    <Animated.View entering={liftIn(0)} style={{ marginHorizontal: space.lg, marginTop: SECTION_GAP }}>
      <Press haptic onPress={() => void go()} style={s.again}>
        <View style={s.againIcon}><Icon name="rotate-ccw" size={20} color={colors.maroon} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: "900" }]}>Order again</Text>
          <Text style={type.small}>Your last order · {items} {items === 1 ? "item" : "items"} · {rupees(last.total)}</Text>
        </View>
        <View style={s.againBtn}><Text style={s.againBtnText}>{busy ? "…" : "Add all"}</Text></View>
      </Press>
    </Animated.View>
  );
}

/** Section title with a "See all" link. */
export function SectionHead({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return <View style={s.head}><Text style={s.title}>{title}</Text>{onSeeAll && <Press onPress={onSeeAll} haptic><Text style={s.link}>See all</Text></Press>}</View>;
}

const s = StyleSheet.create({
  live: { backgroundColor: colors.maroon, borderRadius: radius.lg, padding: space.lg, gap: 8, ...shadow.lift },
  liveTag: { color: colors.yellow, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  liveBy: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "700" },
  liveTitle: { color: colors.white, fontSize: 20, fontWeight: "900", letterSpacing: -0.4 },
  liveSub: { color: colors.yellow, fontSize: 13, fontWeight: "800" },
  track: { flexDirection: "row", gap: 4, marginVertical: 2 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, minHeight: 28 },
  title: { fontSize: 19, fontWeight: "900", letterSpacing: -0.4, color: colors.ink },
  link: { fontSize: 13, fontWeight: "800", color: colors.maroon, paddingVertical: 6, paddingLeft: space.md },
  offer: { width: 170, borderRadius: radius.lg, padding: space.md, gap: 6 },
  offerIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  offerDesc: { fontSize: 14, fontWeight: "800", minHeight: 36, lineHeight: 18 },
  code: { alignSelf: "flex-start", borderWidth: 1.5, borderStyle: "dashed", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  codeText: { fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  offerMin: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  again: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, ...shadow.card },
  againIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  againBtn: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 14, height: 34, alignItems: "center", justifyContent: "center" },
  againBtnText: { fontWeight: "900", color: colors.maroon, fontSize: 13 },
});

/** Space between the search bar and the tab strip under it. The home header adds the same amount to its height. */
export const TABS_GAP = space.lg;

/** Blinkit-style tab strip under the search bar: "All" and each top category. Sits on the maroon header. */
export function CategoryTabs({ categories, pics, active, onPick }: { categories: Category[]; pics: Record<string, { uri: string; product: boolean }>; active: string | null; onPick: (id: string | null) => void }) {
  const tab = (id: string | null, label: string, icon: IconName, uri?: string) => {
    const on = active === id;
    return (
      <Press key={id ?? "all"} haptic onPress={() => onPick(id)} style={t.tab}>
        <View style={[t.circle, on && { backgroundColor: colors.yellow, borderColor: colors.yellow }]}>
          {uri ? <Image source={{ uri }} style={{ width: 34, height: 34, borderRadius: 17 }} contentFit="cover" /> : <Icon name={icon} size={18} color={on ? colors.maroon : colors.white} />}
        </View>
        <Text style={[t.label, on && { color: colors.yellow, fontWeight: "900" }]} numberOfLines={1}>{label}</Text>
        <View style={[t.bar, on && { backgroundColor: colors.yellow }]} />
      </Press>
    );
  };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: TABS_GAP }} contentContainerStyle={{ gap: space.xs, paddingRight: space.lg }}>
      {tab(null, "All", "grid")}
      {categories.map(c => tab(c.id, c.name, "shopping-bag", pics[c.id]?.uri))}
    </ScrollView>
  );
}

const t = StyleSheet.create({
  tab: { width: 70, alignItems: "center", gap: 3 },
  circle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  label: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700" },
  bar: { height: 3, width: 28, borderRadius: 2, backgroundColor: "transparent", marginTop: 1 },
});
