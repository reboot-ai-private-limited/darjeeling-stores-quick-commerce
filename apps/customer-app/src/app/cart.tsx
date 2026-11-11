import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appliedCoupon, removeCoupon } from "../api/account";
import { listAddresses } from "../api/addresses";
import { getStoreStatus, REASONS, syncCart, toServerLines, type ServerCart, type StoreStatus } from "../api/cart";
import { Button, Header, Icon, Press, Screen, tap } from "../components/ui";
import { useCart, type Line } from "../state/cart";
import { useStore } from "../state/store";
import { colors, radius, rupees, shadow, space, type } from "../theme";

/** Screen 16: the cart. Items with steppers, an ETA strip, a free-delivery bar, the items bill and Checkout. */
export default function CartScreen() {
  const { lines, count, subtotal, savings, inc, remove, removeLine, applyServer } = useCart();
  const { zone, signedIn } = useStore();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [server, setServer] = useState<ServerCart | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { if (signedIn && lines.length > 0) void appliedCoupon().then(setCoupon).catch(() => undefined); }, [signedIn, lines.length]));
  const linesRef = useRef<Line[]>(lines);
  linesRef.current = lines;

  useEffect(() => { if (zone) void getStoreStatus(zone.id).then(setStatus).catch(() => setStatus(null)); }, [zone]);

  // Signed-in customers: send the cart to the server (after a short pause) so prices and stock are checked.
  // Only quantity changes trigger it; price updates that come back do not, so it cannot loop.
  const signature = useMemo(() => lines.map(l => `${l.variantId}:${l.qty}`).join("|"), [lines]);
  useEffect(() => {
    if (!signedIn || !zone || linesRef.current.length === 0) return;
    let live = true;
    const t = setTimeout(async () => {
      const sent = linesRef.current;
      try {
        const r = await syncCart(sent);
        if (!live) return;
        setSyncError(null); setServer(r.cart);
        if (r.corrections.length) {
          setNotes(r.corrections.map(c => `${sent.find(l => l.variantId === c.variantId)?.name ?? "An item"} ${REASONS[c.reason] ?? "was updated"}.`));
        } else setNotes([]);
        applyServer(toServerLines(r.cart), r.corrections);
      } catch (e) { if (live) setSyncError(e instanceof Error ? e.message : "Couldn't check prices."); }
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [signature, signedIn, zone, applyServer]);

  const freeAbove = server?.freeDelivery?.threshold ?? status?.freeDeliveryAbove ?? null;
  const toFree = freeAbove ? Math.max(0, freeAbove - subtotal) : 0;
  const minOrder = status?.minOrder ?? 0;
  const belowMin = minOrder > 0 && subtotal < minOrder;
  const closed = status ? !status.accepting && !status.preOrderAvailable : false;
  const eta = status ? `${status.eta.minMinutes}-${status.eta.maxMinutes} min` : null;
  const unavailable = lines.some(l => l.available === false);

  /** With a saved address, go straight to checkout (it has a Change button). Only a customer with no address is sent to add one. */
  const checkout = async () => {
    if (!signedIn) { router.push("/login"); return; }
    try {
      const list = await listAddresses();
      if (list.length > 0) { router.push("/checkout"); return; }
    } catch { /* fall through: checkout itself asks for an address if it finds none */ }
    router.push({ pathname: "/address/edit", params: { pick: "1" } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title="Cart" subtitle={count > 0 ? `${count} ${count === 1 ? "item" : "items"}` : undefined} /></View>

        {lines.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}><Icon name="shopping-cart" size={44} color={colors.maroon} /></View>
            <Text style={type.title}>Your cart is empty</Text>
            <Text style={[type.small, { textAlign: "center" }]}>Add tea, snacks and spices and they'll show up here.</Text>
            <Button label="Start shopping" onPress={() => router.dismissTo("/home")} style={{ alignSelf: "stretch", marginTop: space.md }} />
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 170 + insets.bottom, gap: space.md }}>
            {eta && status?.accepting && (
              <View style={s.eta}><Icon name="zap" size={18} color={colors.maroon} /><Text style={s.etaText}>Arriving in {eta}</Text></View>
            )}
            {status && !status.accepting && (
              <Press onPress={() => router.push("/closed")} style={[s.warn]}><Icon name="clock" size={18} color={colors.amber} /><Text style={[type.small, { flex: 1, color: colors.ink }]}>{status.pauseMessage ?? (status.preOrderAvailable ? "The store is closed. You can pre-order for a later delivery." : "The store isn't taking orders right now.")}</Text><Icon name="chevron-right" size={16} color={colors.amber} /></Press>
            )}
            {freeAbove ? (
              <View style={s.card}>
                <Text style={[type.body, { fontWeight: "800" }]}>{toFree > 0 ? `Add ${rupees(toFree)} more for FREE delivery` : "You've unlocked FREE delivery"}</Text>
                <View style={s.track}><View style={[s.fill, { width: `${Math.min(100, (subtotal / freeAbove) * 100)}%`, backgroundColor: toFree > 0 ? colors.yellow : colors.green }]} /></View>
              </View>
            ) : null}

            {notes.map(n => <Animated.View entering={FadeIn} key={n} style={s.warn}><Icon name="info" size={16} color={colors.amber} /><Text style={[type.small, { flex: 1, color: colors.ink }]}>{n}</Text></Animated.View>)}

            <View style={s.card}>
              {lines.map((l, i) => (
                <View key={l.variantId} style={[s.line, i > 0 && s.lineSep]}>
                  <View style={s.thumb}>{l.imageUrl ? <Image source={{ uri: l.imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : <Icon name="package" size={24} color={colors.faint} />}</View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.name} numberOfLines={2}>{l.name}</Text>
                    <Text style={type.small}>{l.label}</Text>
                    {l.available === false && <Text style={[type.small, { color: colors.red, fontWeight: "800" }]}>Currently unavailable</Text>}
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                      <Text style={s.price}>{rupees(l.price * l.qty)}</Text>
                      {l.mrp > l.price && <Text style={s.mrp}>{rupees(l.mrp * l.qty)}</Text>}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: space.sm }}>
                    <View style={s.stepper}>
                      <Press onPress={() => { tap(); remove(l.variantId); }} style={s.stepBtn}><Icon name="minus" size={15} color={colors.white} /></Press>
                      <Text style={s.stepQty}>{l.qty}</Text>
                      <Press disabled={l.qty >= l.maxQty} onPress={() => { tap(); inc(l.variantId); }} style={[s.stepBtn, l.qty >= l.maxQty && { opacity: 0.4 }]}><Icon name="plus" size={15} color={colors.white} /></Press>
                    </View>
                    <Press onPress={() => { tap(); removeLine(l.variantId); }} style={{ padding: 4 }}><Icon name="trash-2" size={17} color={colors.faint} /></Press>
                  </View>
                </View>
              ))}
            </View>

            {signedIn && (
              coupon ? (
                <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.greenSoft }]}>
                  <Icon name="check-circle" size={20} color={colors.green} />
                  <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "900", color: colors.green }]}>{coupon} applied</Text><Text style={type.small}>Discount is added at checkout</Text></View>
                  <Press onPress={() => { void removeCoupon().then(() => setCoupon(null)).catch(() => undefined); }} haptic><Text style={{ color: colors.red, fontWeight: "800", padding: 6 }}>Remove</Text></Press>
                </View>
              ) : (
                <Press onPress={() => router.push("/coupons")} haptic style={[s.card, { flexDirection: "row", alignItems: "center", gap: space.md }]}>
                  <Icon name="tag" size={20} color={colors.maroon} />
                  <Text style={[type.body, { flex: 1, fontWeight: "700" }]}>Apply coupon</Text>
                  <Text style={{ color: colors.maroon, fontWeight: "800", fontSize: 12 }}>View offers</Text>
                  <Icon name="chevron-right" size={18} color={colors.faint} />
                </Press>
              )
            )}

            <View style={s.card}>
              <Text style={[type.h2, { marginBottom: space.sm }]}>Bill details</Text>
              <BillRow label={`Items total (${count})`} value={rupees(subtotal)} />
              {savings > 0 && <BillRow label="You save on MRP" value={`- ${rupees(savings)}`} tone={colors.green} />}
              <BillRow label="Delivery and other fees" value="Shown at checkout" muted />
              <View style={s.totalRow}><Text style={[type.body, { fontWeight: "900" }]}>Items total</Text><Text style={[type.body, { fontWeight: "900" }]}>{rupees(subtotal)}</Text></View>
            </View>

            {belowMin && <Text style={[type.small, { color: colors.red, textAlign: "center" }]}>Minimum order is {rupees(minOrder)}. Add {rupees(minOrder - subtotal)} more.</Text>}
            {syncError && <Text style={[type.small, { textAlign: "center" }]}>Couldn't check live prices just now. They'll be confirmed at checkout.</Text>}
          </ScrollView>
        )}
      </Screen>

      {lines.length > 0 && (
        <View style={[s.bar, { paddingBottom: insets.bottom + space.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.barTotal}>{rupees(subtotal)}</Text>
            <Text style={type.small}>{signedIn ? "Items total" : "Sign in to check out"}</Text>
          </View>
          <Button
            label={closed ? "Store closed" : signedIn ? (status && !status.accepting ? "Pre-order" : "Checkout") : "Login to continue"} icon="arrow-right"
            disabled={belowMin || closed || unavailable} onPress={checkout} style={{ flex: 1.3 }}
          />
        </View>
      )}
    </View>
  );
}

function BillRow({ label, value, tone, muted }: { label: string; value: string; tone?: string; muted?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
      <Text style={[type.body, { color: muted ? colors.muted : colors.ink }]}>{label}</Text>
      <Text style={[type.body, { color: tone ?? (muted ? colors.muted : colors.ink), fontWeight: "600" }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.xl },
  emptyIcon: { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center", marginBottom: space.md },
  eta: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.yellowSoft, borderRadius: radius.md, padding: space.md },
  etaText: { fontSize: 14, fontWeight: "900", color: colors.maroon },
  warn: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: space.md },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.creamDeep, marginTop: space.sm, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  lineSep: { borderTopWidth: 1, borderTopColor: colors.line },
  thumb: { width: 68, height: 68, borderRadius: radius.md, backgroundColor: colors.cream, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontWeight: "700", color: colors.ink, lineHeight: 18 },
  price: { fontSize: 15, fontWeight: "900", color: colors.ink },
  mrp: { fontSize: 12, color: colors.faint, textDecorationLine: "line-through" },
  stepper: { width: 82, height: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.maroon, borderRadius: 10 },
  stepBtn: { width: 26, height: 34, alignItems: "center", justifyContent: "center" },
  stepQty: { color: colors.white, fontWeight: "900", fontSize: 14 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: space.md, marginTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: space.lg, backgroundColor: colors.white, paddingHorizontal: space.lg, paddingTop: space.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, ...shadow.lift },
  barTotal: { fontSize: 22, fontWeight: "900", color: colors.ink },
});
