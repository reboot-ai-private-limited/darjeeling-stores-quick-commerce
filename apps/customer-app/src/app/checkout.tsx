import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addressLine, listAddresses, type Address } from "../api/addresses";
import { getStoreStatus, syncCart, toServerLines, type StoreStatus } from "../api/cart";
import { ApiError } from "../api/http";
import { getSlots, slotMessage, type Slot } from "../api/preorder";
import { checkoutMessage, createQuote, getTipOptions, newKey, placeOrder, type PaymentMethod, type Quote, type TipOptions } from "../api/orders";
import { Button, Header, Icon, Press, Screen, tap, type IconName } from "../components/ui";
import { useCart } from "../state/cart";
import { useStore } from "../state/store";
import { colors, radius, rupees, shadow, space, type } from "../theme";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Screens 21-22: address, delivery time, tip, payment method, the bill from a server quote, and Place order. */
export default function Checkout() {
  const { zone, signedIn, addressId } = useStore();
  const { lines, count, savings, clear, applyServer } = useCart();
  const insets = useSafeAreaInsets();

  const [address, setAddress] = useState<Address | null | undefined>(undefined); // undefined = loading
  const [tips, setTips] = useState<TipOptions | null>(null);
  const [tip, setTip] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("cod");
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  /** Closed but taking pre-orders: the customer must choose a delivery window. */
  const needsSlot = !!status && !status.accepting && !!status.preOrderAvailable;
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoneChange, setZoneChange] = useState<{ removed?: { name: string }[]; repriced?: { oldUnitPrice: number; newUnitPrice: number }[] } | null>(null);
  const [accept, setAccept] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const keyRef = useRef<{ quoteId: string; key: string } | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void listAddresses().then(list => { if (live) setAddress(list.find(a => a.id === addressId) ?? list.find(a => a.isDefault) ?? list[0] ?? null); }).catch(() => { if (live) setAddress(null); });
    return () => { live = false; };
  }, [signedIn, addressId]);
  useEffect(() => { if (zone) void getTipOptions(zone.id).then(setTips).catch(() => setTips(null)); }, [zone]);
  useEffect(() => { if (zone) void getStoreStatus(zone.id).then(setStatus).catch(() => setStatus(null)); }, [zone]);
  const loadSlots = () => { if (zone) void getSlots(zone.id).then(r => { setSlots(r.slots); setSlot(cur => r.slots.find(x => x.start === cur?.start && x.remaining > 0) ?? null); }).catch(() => setSlots([])); };
  useEffect(() => { if (needsSlot) loadSlots(); }, [needsSlot, zone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Get a fresh quote whenever the address, tip or cart changes: first send the cart (so the server prices what we show), then ask for the bill.
  const signature = useMemo(() => lines.map(l => `${l.variantId}:${l.qty}`).join("|"), [lines]);
  useEffect(() => {
    if (!address || lines.length === 0) return;
    if (needsSlot && !slot) { setQuote(null); setQuoting(false); return; } // choose a delivery time first
    let live = true;
    setQuoting(true); setError(null);
    const t = setTimeout(async () => {
      try {
        const cart = await syncCart(lines, address.id);
        if (!live) return;
        applyServer(toServerLines(cart.cart), cart.corrections);
        if (cart.corrections.length) { setBanner("Some items changed, so we updated your cart."); }
        if (cart.cart.items.length === 0) { setQuote(null); setError("Your items are no longer available."); setQuoting(false); return; }
        if (cart.corrections.length) return; // the local cart changed; this effect runs again with the new cart
        const q = await createQuote({ addressId: address.id, paymentMethod: method, tipAmount: tip, acceptZoneChange: accept, scheduledWindow: needsSlot && slot ? { start: slot.start, end: slot.end } : null });
        if (!live) return;
        setQuote(q); setZoneChange(null); setQuoting(false);
      } catch (e) {
        if (!live) return;
        setQuote(null); setQuoting(false);
        if (e instanceof ApiError && e.code === "ZONE_CHANGE_UNCONFIRMED") { setZoneChange((e.details?.zoneChange as typeof zoneChange) ?? {}); return; }
        setError(e instanceof ApiError ? checkoutMessage(e.code, e.details, e.message) : "Couldn't get your bill. Please try again.");
      }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [address, tip, method, accept, signature, slot, needsSlot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signedIn) return <Redirect href="/login" />;
  if (address === null) return <Redirect href={{ pathname: "/addresses", params: { pick: "1" } }} />;
  if (lines.length === 0 && !placing) return <Redirect href="/cart" />;

  const place = async () => {
    if (!quote || placing) return;
    if (!keyRef.current || keyRef.current.quoteId !== quote.id) keyRef.current = { quoteId: quote.id, key: newKey() };
    setPlacing(true); setError(null); setBanner(null);
    try {
      const { group, payment } = await placeOrder({ quoteId: quote.id, paymentMethod: method, deliveryNotes: note.trim() || null }, keyRef.current.key);
      tap("success");
      clear();
      if (method === "online") {
        // Online orders wait for payment. Without checkout data (the gateway was busy) the pay screen asks the server for a fresh attempt.
        router.replace({ pathname: "/pay/[id]", params: { id: group.id, ...(payment ? { key: payment.razorpayKeyId, rzp: payment.razorpayOrderId, amount: String(payment.amount), exp: payment.expiresAt } : {}) } });
      } else router.replace({ pathname: "/order-placed", params: { id: group.id } });
    } catch (e) {
      setPlacing(false);
      if (e instanceof ApiError && e.code === "QUOTE_CHANGED" && e.details?.quote) {
        const nq = e.details.quote as Quote; setQuote(nq);
        setBanner(`The total changed to ${rupees(nq.pricing.total)}. Please check it and place the order again.`);
      } else if (e instanceof ApiError && e.code === "QUOTE_EXPIRED") {
        setBanner(checkoutMessage(e.code)); setQuoting(true); setAddress(a => (a ? { ...a } : a)); // a new object makes the quote effect run again
      } else if (slotMessage(e)) { setBanner(slotMessage(e)); setSlot(null); loadSlots(); }
      else setError(e instanceof ApiError ? checkoutMessage(e.code, e.details, e.message) : "Couldn't place the order. Please try again.");
    }
  };

  const total = quote?.pricing.total ?? 0;
  const canPlace = !!quote && !placing && !quoting && !error;
  const latest = quote ? quote.allocation.map(a => a.eta.promisedAt).sort().at(-1) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title="Checkout" /></View>
        {address === undefined ? <ActivityIndicator color={colors.maroon} style={{ marginTop: 80 }} /> : (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 170 + insets.bottom, gap: space.lg }}>

              {/* Hero: when it arrives and where */}
              <LinearGradient colors={[colors.maroon, colors.maroonSoft]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
                <View style={s.heroBlob} />
                <View style={s.heroBadge}><Icon name="zap" size={13} color={colors.maroon} /><Text style={s.heroBadgeText}>{needsSlot ? "PRE-ORDER" : quote ? "EXPRESS DELIVERY" : "CHECKING DELIVERY"}</Text></View>
                <Text style={s.heroTitle}>{needsSlot ? (slot ? slot.label : "Choose a delivery time") : quote ? (latest ? `Arriving by ${time(latest)}` : "Fast delivery") : "Getting your delivery time…"}</Text>
                {quote?.split && <Text style={s.heroSub}>In {quote.allocation.length} deliveries, from different stores</Text>}
                <View style={s.heroAddr}>
                  <Icon name="map-pin" size={16} color={colors.yellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.heroAddrTitle}>{address.label} · {address.contactName}</Text>
                    <Text style={s.heroAddrLine} numberOfLines={2}>{addressLine(address)}</Text>
                  </View>
                  <Press onPress={() => router.push({ pathname: "/addresses", params: { pick: "1" } })} haptic style={s.change}><Text style={s.changeText}>Change</Text></Press>
                </View>
              </LinearGradient>

              {quote?.split && (
                <View style={s.card}>
                  {quote.allocation.map(a => <View key={a.warehouseId} style={{ flexDirection: "row", gap: space.sm, alignItems: "center", paddingVertical: 2 }}><Icon name="package" size={15} color={colors.maroon} /><Text style={[type.small, { flex: 1, color: colors.ink }]}>{a.warehouseName}</Text><Text style={[type.small, { fontWeight: "800", color: colors.maroon }]}>by {time(a.eta.promisedAt)}</Text></View>)}
                </View>
              )}

              {banner && <View style={s.warn}><Icon name="info" size={16} color={colors.amber} /><Text style={[type.small, { flex: 1, color: colors.ink }]}>{banner}</Text></View>}
              {zoneChange && (
                <View style={s.warn}>
                  <Icon name="alert-triangle" size={16} color={colors.amber} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={[type.small, { color: colors.ink, fontWeight: "800" }]}>This address is in a different delivery area.</Text>
                    {zoneChange.removed?.map(r => <Text key={r.name} style={type.small}>{r.name} isn't available there and will be removed.</Text>)}
                    {zoneChange.repriced && zoneChange.repriced.length > 0 && <Text style={type.small}>{zoneChange.repriced.length} item price(s) will change.</Text>}
                    <Press onPress={() => setAccept(true)} haptic><Text style={s.link}>Accept changes and continue</Text></Press>
                  </View>
                </View>
              )}

              {/* Items, with photos */}
              <View>
                <Section icon="shopping-bag" title={`Your items (${count})`} />
                <View style={s.card}>
                  {lines.map((l, i) => (
                    <View key={l.variantId} style={[s.itemRow, i > 0 && s.sep]}>
                      <View style={s.thumb}>
                        {l.imageUrl ? <Image source={{ uri: l.imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : <Icon name="package" size={22} color={colors.faint} />}
                        <View style={s.qty}><Text style={s.qtyText}>×{l.qty}</Text></View>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.itemName} numberOfLines={2}>{l.name}</Text>
                        <Text style={type.small}>{l.label}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={s.itemPrice}>{rupees(l.qty * l.price)}</Text>
                        {l.mrp > l.price && <Text style={s.itemMrp}>{rupees(l.qty * l.mrp)}</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              {/* Tip */}
              {tips?.enabled && (
                <View style={[s.card, s.tipCard]}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                    <Text style={s.tipTitle}>Tip your delivery partner</Text>
                    <Text style={type.small}>· all of it goes to them</Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {[0, ...tips.presets].map(v => (
                      <Press key={v} onPress={() => { tap(); setTip(v); }} style={[s.tip, tip === v && s.tipOn]}>
                        <Text style={[s.tipText, tip === v && { color: colors.white }]}>{v === 0 ? "No tip" : rupees(v)}</Text>
                      </Press>
                    ))}
                  </View>
                </View>
              )}

              {/* Note */}
              <View>
                <Section icon="edit-3" title="Note for the delivery partner" />
                <View style={[s.card, { paddingVertical: space.sm }]}>
                  <TextInput value={note} onChangeText={setNote} placeholder="Ring the bell twice (optional)" placeholderTextColor={colors.faint} maxLength={300} style={s.note} />
                </View>
              </View>

              {/* Delivery time: only when the store is closed and taking pre-orders */}
              {needsSlot && (
                <View>
                  <Section icon="calendar" title="Choose delivery time" />
                  <View style={[s.card, { gap: space.sm }]}>
                    <Text style={type.small}>The store is closed now. Pick a time window for your pre-order. Late-night and rain fees don't apply to pre-orders.</Text>
                    {!slots && <ActivityIndicator color={colors.maroon} />}
                    {slots?.length === 0 && <Text style={[type.small, { color: colors.red }]}>No delivery slots are open for booking right now.</Text>}
                    {slots?.map(sl => {
                      const full = sl.remaining <= 0; const on = slot?.start === sl.start;
                      return (
                        <Press key={sl.start} disabled={full} onPress={() => { tap(); setSlot(sl); }} style={[s.pay, on && s.payOn, full && { opacity: 0.45 }]}>
                          <Icon name="clock" size={20} color={colors.maroon} />
                          <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{sl.label}</Text><Text style={type.small}>{full ? "Fully booked" : sl.remaining <= 5 ? `Only ${sl.remaining} left` : "Available"}</Text></View>
                          {on && <View style={s.radioOn}><View style={s.dot} /></View>}
                        </Press>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Payment */}
              <View>
                <Section icon="credit-card" title="Payment method" />
                <View style={{ gap: space.sm }}>
                  {(() => {
                    const codOk = quote ? quote.payment.codAllowed : true;
                    const onlineOk = quote ? quote.payment.onlineAllowed : true;
                    const opt = (m: PaymentMethod, icon: IconName, title: string, sub: string, ok: boolean, why: string) => (
                      <Press key={m} disabled={!ok} onPress={() => { tap(); setMethod(m); }} style={[s.pay, method === m && s.payOn, !ok && { opacity: 0.5 }]}>
                        <View style={[s.payIcon, method === m && { backgroundColor: colors.white }]}><Icon name={icon} size={20} color={method === m ? colors.maroon : colors.muted} /></View>
                        <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>{title}</Text><Text style={type.small}>{ok ? sub : why}</Text></View>
                        {method === m && <View style={s.radioOn}><View style={s.dot} /></View>}
                      </Press>
                    );
                    return (
                      <>
                        {opt("cod", "dollar-sign", "Cash on delivery", quote ? `Keep ${rupees(total)} ready` : "Pay the delivery partner at your door", codOk, quote?.payment.codMaxAmount ? `Not available above ${rupees(quote.payment.codMaxAmount)}` : "Not available for this order")}
                        {opt("online", "credit-card", "Pay online", "UPI, card and netbanking", onlineOk, "Online payment isn't available right now")}
                      </>
                    );
                  })()}
                </View>
              </View>

              {/* Bill */}
              <View>
                <Section icon="file-text" title="Bill details" />
                <View style={s.card}>
                  {quoting && !quote ? <ActivityIndicator color={colors.maroon} /> : quote ? (
                    <>
                      <Bill label="Items total" value={rupees(quote.pricing.subtotal)} />
                      {quote.pricing.discount > 0 && <Bill label="Discount" value={`- ${rupees(quote.pricing.discount)}`} tone={colors.green} />}
                      {quote.pricing.charges.map(c => <Bill key={c.type + c.label} label={c.label} value={c.amount === 0 ? "FREE" : rupees(c.amount)} tone={c.amount === 0 ? colors.green : undefined} />)}
                      {!quote.pricing.taxInclusive && quote.pricing.tax > 0 && <Bill label="Taxes" value={rupees(quote.pricing.tax)} />}
                      <View style={s.totalRow}><Text style={s.totalLabel}>Grand total</Text><Text style={s.totalValue}>{rupees(total)}</Text></View>
                      {quote.pricing.taxInclusive && <Text style={[type.small, { marginTop: 2 }]}>Inclusive of all taxes</Text>}
                      {savings + quote.pricing.discount > 0 && (
                        <View style={s.saved}><Icon name="tag" size={15} color={colors.green} /><Text style={s.savedText}>You're saving {rupees(savings + quote.pricing.discount)} on this order</Text></View>
                      )}
                    </>
                  ) : <Text style={type.small}>{zoneChange ? "Accept the changes above to see your bill." : "Your bill will show here."}</Text>}
                </View>
              </View>

              {error && <View style={s.errBox}><Icon name="alert-circle" size={16} color={colors.red} /><Text style={[type.small, { color: colors.red, flex: 1 }]}>{error}</Text></View>}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </Screen>

      {address && (
        <View style={[s.bar, { paddingBottom: insets.bottom + space.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.barTotal}>{quote ? rupees(total) : "—"}</Text>
            <Text style={type.small}>Cash on delivery</Text>
          </View>
          <Button label={placing ? "Placing…" : "Place order"} icon="check" disabled={!canPlace} onPress={() => void place()} style={{ flex: 1.3 }} />
        </View>
      )}
    </View>
  );
}

/** A small heading with a round icon badge, used above each block. */
function Section({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={s.section}>
      <View style={s.sectionIcon}><Icon name={icon} size={14} color={colors.maroon} /></View>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function Bill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}><Text style={type.body}>{label}</Text><Text style={[type.body, { fontWeight: "600", color: tone ?? colors.ink }]}>{value}</Text></View>;
}

const s = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space.lg, gap: 6, overflow: "hidden", ...shadow.lift },
  heroBlob: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,201,51,0.10)", top: -70, right: -60 },
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 10, height: 24 },
  heroBadgeText: { fontSize: 10, fontWeight: "900", color: colors.maroon, letterSpacing: 0.8 },
  heroTitle: { color: colors.white, fontSize: 26, fontWeight: "900", letterSpacing: -0.7, marginTop: 4 },
  heroSub: { color: "rgba(255,255,255,0.75)", fontSize: 13 },
  heroAddr: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.md, padding: space.md, marginTop: space.sm },
  heroAddrTitle: { color: colors.white, fontSize: 13, fontWeight: "800" },
  heroAddrLine: { color: "rgba(255,255,255,0.8)", fontSize: 12, lineHeight: 16, marginTop: 1 },
  change: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 12, height: 30, alignItems: "center", justifyContent: "center" },
  changeText: { fontSize: 12, fontWeight: "900", color: colors.maroon },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  section: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm, paddingHorizontal: 2 },
  sectionIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: colors.ink, letterSpacing: -0.3 },
  link: { fontSize: 13, fontWeight: "800", color: colors.maroon },
  warn: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: space.md },
  itemRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  sep: { borderTopWidth: 1, borderTopColor: colors.line },
  thumb: { width: 60, height: 60, borderRadius: 14, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", overflow: "visible" },
  qty: { position: "absolute", top: -6, left: -6, backgroundColor: colors.maroon, borderRadius: 10, minWidth: 24, height: 20, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.white },
  qtyText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  itemName: { fontSize: 14, fontWeight: "700", color: colors.ink, lineHeight: 18 },
  itemPrice: { fontSize: 15, fontWeight: "900", color: colors.ink },
  itemMrp: { fontSize: 12, color: colors.faint, textDecorationLine: "line-through" },
  tipCard: { paddingVertical: space.md, paddingHorizontal: space.md },
  tipTitle: { fontSize: 14, fontWeight: "800", color: colors.ink },
  tip: { minWidth: 60, height: 32, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  tipOn: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  tipText: { fontSize: 13, fontWeight: "800", color: colors.ink },
  note: { height: 46, fontSize: 15, color: colors.ink, outlineStyle: "none" as never },
  pay: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white, padding: space.md },
  payOn: { borderColor: colors.maroon, backgroundColor: colors.yellowSoft },
  payIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  radioOn: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.maroon, alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.maroon },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: space.md, marginTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: "dashed" },
  totalLabel: { fontSize: 16, fontWeight: "900", color: colors.ink },
  totalValue: { fontSize: 20, fontWeight: "900", color: colors.ink },
  saved: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.greenSoft, borderRadius: radius.md, padding: space.md, marginTop: space.md },
  savedText: { fontSize: 13, fontWeight: "800", color: colors.green, flex: 1 },
  errBox: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.redSoft, borderRadius: radius.md, padding: space.md },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: space.lg, backgroundColor: colors.white, paddingHorizontal: space.lg, paddingTop: space.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, ...shadow.lift },
  barTotal: { fontSize: 22, fontWeight: "900", color: colors.ink },
});
