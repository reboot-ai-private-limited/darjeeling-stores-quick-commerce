import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { applyCoupon, appliedCoupon, COUPON_WHY, listCoupons, removeCoupon, type CouponRow } from "../api/account";
import { ApiError } from "../api/http";
import { CouponSuccess } from "../components/CouponSuccess";
import { Bone } from "../components/Skeleton";
import { Header, Icon, Press, Screen, tap } from "../components/ui";
import { useCart } from "../state/cart";
import { useStore } from "../state/store";
import { colors, radius, rupees, shadow, space, type } from "../theme";

/** The big label on the left of an offer, like the stub of a ticket. */
const stub = (c: CouponRow): { top: string; bottom: string } =>
  c.type === "percent" ? { top: `${c.value}%`, bottom: "OFF" }
  : c.type === "flat" ? { top: rupees(c.value), bottom: "OFF" }
  : { top: "FREE", bottom: "DELIVERY" };

/** Screen 17: type a code or pick an offer. Offers that can't be used yet are greyed with what is missing. */
export default function Coupons() {
  const { zone } = useStore();
  const { subtotal } = useCart();
  const [rows, setRows] = useState<CouponRow[] | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ code: string; description: string } | null>(null);

  const load = useCallback(() => {
    if (!zone) { setRows([]); return; }
    void listCoupons(zone.id, subtotal).then(setRows).catch(() => setRows([]));
    void appliedCoupon().then(setApplied).catch(() => setApplied(null));
  }, [zone, subtotal]);
  useEffect(load, [load]);

  const apply = async (c: string) => {
    setBusy(c); setErr("");
    try {
      const r = await applyCoupon(c);
      tap("success");
      setDone({ code: r.code, description: r.description });
      setTimeout(() => router.back(), 1500); // let the animation play, then return to the cart
      return;
    }
    catch (e) {
      const why = e instanceof ApiError ? COUPON_WHY[String(e.details?.reason)] : undefined;
      setErr(why ?? (e instanceof Error ? e.message : "That coupon can't be used."));
    } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("remove");
    try { await removeCoupon(); setApplied(null); } catch { setErr("Couldn't remove the coupon. Try again."); } finally { setBusy(null); }
  };

  const sorted = rows ? [...rows].sort((a, b) => Number(b.applicable) - Number(a.applicable)) : null;
  const reasonText = (c: CouponRow) => {
    if (c.applicable) return null;
    if (c.reason === "min_order" && c.minOrder > subtotal) return `Add ${rupees(c.minOrder - subtotal)} more to use this`;
    return COUPON_WHY[c.reason ?? ""] ?? "Not available right now";
  };

  return (
    <View style={{ flex: 1 }}>
    <Screen scroll>
      <Header title="Apply coupon" />

      {applied && (
        <Animated.View entering={FadeIn} style={s.applied}>
          <View style={s.appliedIcon}><Icon name="check" size={18} color={colors.white} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { fontWeight: "900", color: colors.green }]}>{applied} applied</Text>
            <Text style={type.small}>The discount shows in your bill.</Text>
          </View>
          <Press onPress={() => void remove()} disabled={busy === "remove"} haptic><Text style={s.removeText}>{busy === "remove" ? "…" : "Remove"}</Text></Press>
        </Animated.View>
      )}

      <View style={s.codeBox}>
        <Icon name="tag" size={18} color={colors.muted} />
        <TextInput
          value={code} onChangeText={t => { setCode(t.toUpperCase().replace(/\s/g, "")); setErr(""); }} autoCapitalize="characters" autoCorrect={false}
          placeholder="Have a code? Enter it here" placeholderTextColor={colors.faint} style={s.input} returnKeyType="done"
          onSubmitEditing={() => { if (code) void apply(code); }} maxLength={20} accessibilityLabel="Coupon code"
        />
        <Press onPress={() => void apply(code)} disabled={!code.trim() || !!busy} haptic style={[s.applyBtn, (!code.trim() || !!busy) && { opacity: 0.4 }]}>
          <Text style={s.applyText}>{busy === code ? "…" : "APPLY"}</Text>
        </Press>
      </View>
      {!!err && <View style={s.err}><Icon name="alert-circle" size={15} color={colors.red} /><Text style={[type.small, { color: colors.red, flex: 1 }]}>{err}</Text></View>}

      <Text style={[type.label, { marginTop: space.xl, marginBottom: space.md }]}>AVAILABLE OFFERS</Text>

      {!sorted && [0, 1, 2].map(i => <Bone key={i} h={104} r={radius.lg} style={{ marginBottom: space.md }} />)}

      {sorted?.length === 0 && (
        <View style={{ alignItems: "center", gap: space.sm, marginTop: 40 }}>
          <Icon name="tag" size={40} color={colors.faint} />
          <Text style={type.h2}>No offers right now</Text>
          <Text style={[type.small, { textAlign: "center" }]}>New offers show up here. You can still enter a code above.</Text>
        </View>
      )}

      <View style={{ gap: space.md }}>
        {sorted?.map((c, i) => {
          const st = stub(c);
          const on = c.applicable;
          const isApplied = applied === c.code;
          const why = reasonText(c);
          const off = !on || isApplied;
          return (
            <Animated.View key={c.code} entering={FadeIn.delay(i * 50)} style={[s.ticket, !on && { opacity: 0.6 }]}>
              <View style={[s.stub, { backgroundColor: on ? colors.maroon : colors.faint }]}>
                <Text style={s.stubTop} numberOfLines={1} adjustsFontSizeToFit>{st.top}</Text>
                <Text style={s.stubBottom}>{st.bottom}</Text>
              </View>
              <View style={s.notch} />
              <View style={{ flex: 1, padding: space.md, gap: 4 }}>
                <View style={s.codePill}><Text style={s.codeText}>{c.code}</Text></View>
                <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={2}>{c.description}</Text>
                {c.minOrder > 0 && <Text style={type.small}>Min. order {rupees(c.minOrder)}</Text>}
                {!!why && <View style={s.why}><Icon name="info" size={13} color={colors.amber} /><Text style={s.whyText}>{why}</Text></View>}
                <Press onPress={() => { if (!isApplied) void apply(c.code); }} disabled={off || !!busy} haptic style={[s.useBtn, off && { backgroundColor: isApplied ? colors.greenSoft : colors.creamDeep }]}>
                  <Text style={[s.useText, off && { color: isApplied ? colors.green : colors.muted }]}>{isApplied ? "APPLIED" : busy === c.code ? "…" : "TAP TO APPLY"}</Text>
                </Press>
              </View>
            </Animated.View>
          );
        })}
      </View>
    </Screen>
    {done && <CouponSuccess code={done.code} description={done.description} />}
    </View>
  );
}

const s = StyleSheet.create({
  applied: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.greenSoft, borderRadius: radius.lg, padding: space.md, marginBottom: space.md },
  appliedIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  removeText: { color: colors.red, fontWeight: "800", fontSize: 13, padding: 6 },
  codeBox: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.white, borderRadius: radius.pill, paddingLeft: space.lg, paddingRight: 6, height: 56, borderWidth: 1.5, borderColor: colors.line, ...shadow.card },
  input: { flex: 1, fontSize: 15, fontWeight: "800", letterSpacing: 1, color: colors.ink },
  applyBtn: { height: 44, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.maroon, alignItems: "center", justifyContent: "center" },
  applyText: { color: colors.yellow, fontWeight: "900", fontSize: 13, letterSpacing: 0.8 },
  err: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space.sm, backgroundColor: colors.redSoft, borderRadius: radius.md, padding: space.md },
  ticket: { flexDirection: "row", backgroundColor: colors.white, borderRadius: radius.lg, overflow: "hidden", ...shadow.card },
  stub: { width: 92, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  stubTop: { color: colors.yellow, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  stubBottom: { color: colors.white, fontSize: 11, fontWeight: "900", letterSpacing: 1.5, marginTop: 2 },
  notch: { width: 0, borderLeftWidth: 1.5, borderLeftColor: colors.line, borderStyle: "dashed" },
  codePill: { alignSelf: "flex-start", borderWidth: 1.5, borderColor: colors.maroon, borderStyle: "dashed", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.yellowSoft },
  codeText: { color: colors.maroon, fontWeight: "900", letterSpacing: 1.2, fontSize: 13 },
  why: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.amberSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  whyText: { color: colors.amber, fontWeight: "800", fontSize: 12 },
  useBtn: { alignSelf: "flex-start", marginTop: 6, height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  useText: { color: colors.maroon, fontWeight: "900", fontSize: 12, letterSpacing: 0.6 },
});
