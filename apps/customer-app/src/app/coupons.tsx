import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { applyCoupon, COUPON_WHY, listCoupons, type CouponRow } from "../api/account";
import { ApiError } from "../api/http";
import { Button, Card, Header, Icon, Screen } from "../components/ui";
import { useCart } from "../state/cart";
import { useStore } from "../state/store";
import { colors, radius, rupees, space, type } from "../theme";

/** Screen 17: type a code or pick one. Coupons that don't apply are greyed with the reason. */
export default function Coupons() {
  const { zone } = useStore();
  const { subtotal } = useCart();
  const [rows, setRows] = useState<CouponRow[] | null>(null);
  const [code, setCode] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState("");
  useEffect(() => { if (zone) void listCoupons(zone.id, subtotal).then(setRows).catch(() => setRows([])); else setRows([]); }, [zone, subtotal]);

  const apply = async (c: string) => {
    setBusy(c); setErr("");
    try { await applyCoupon(c); router.back(); }
    catch (e) {
      const why = e instanceof ApiError ? COUPON_WHY[String(e.details?.reason)] : undefined;
      setErr(why ?? (e instanceof Error ? e.message : "That coupon can't be used."));
    } finally { setBusy(null); }
  };

  return (
    <Screen scroll>
      <Header title="Apply coupon" />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <TextInput value={code} onChangeText={t => setCode(t.toUpperCase())} autoCapitalize="characters" placeholder="Enter coupon code" style={s.input} />
        <Button label="Apply" disabled={!code.trim() || !!busy} onPress={() => void apply(code)} style={{ width: 96 }} />
      </View>
      {!!err && <Text style={[type.small, { color: colors.red, marginTop: space.sm }]}>{err}</Text>}
      <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>Available offers</Text>
      {!rows && <ActivityIndicator color={colors.maroon} style={{ marginTop: 30 }} />}
      {rows?.length === 0 && <Text style={type.small}>No offers right now. Check back soon.</Text>}
      <View style={{ gap: space.md }}>
        {rows?.map(c => (
          <Card key={c.code} style={{ opacity: c.applicable ? 1 : 0.55, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={s.badge}><Icon name="tag" size={20} color={colors.maroon} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "900", letterSpacing: 1 }]}>{c.code}</Text>
              <Text style={type.small}>{c.description}</Text>
              {c.minOrder > 0 && <Text style={type.small}>Minimum order {rupees(c.minOrder)}</Text>}
              {!c.applicable && <Text style={[type.small, { color: colors.amber, fontWeight: "700" }]}>{COUPON_WHY[c.reason ?? ""] ?? "Not available"}</Text>}
            </View>
            <Button label={busy === c.code ? "…" : "Apply"} variant="soft" disabled={!c.applicable || !!busy} onPress={() => void apply(c.code)} style={{ width: 84, height: 44 }} />
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { flex: 1, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: space.lg, height: 56, fontSize: 16, fontWeight: "700", color: colors.ink },
  badge: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
});
