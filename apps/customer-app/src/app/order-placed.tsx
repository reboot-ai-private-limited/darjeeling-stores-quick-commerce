import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { getOrderGroup, type OrderGroup } from "../api/orders";
import { Button, Icon, Screen } from "../components/ui";
import { colors, radius, rupees, shadow, space, type } from "../theme";

const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null);

/** Screen 25: the order went through. Shows the order number, when it arrives, the delivery code to read out, and what to pay. */
export default function OrderPlaced() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [g, setG] = useState<OrderGroup | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { void getOrderGroup(id).then(setG).catch(() => setFailed(true)); }, [id]);

  const goHome = () => { router.dismissAll(); router.replace("/home"); };
  const arrive = g ? g.children.map(c => c.promisedAt).filter(Boolean).sort().at(-1) : null;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingTop: space.xxl, paddingBottom: 140, gap: space.md }}>
        <Animated.View entering={ZoomIn.duration(350)} style={s.tick}><Icon name="check" size={52} color={colors.white} /></Animated.View>
        <Text style={[type.title, { marginTop: space.md }]}>Order placed!</Text>
        {!g && !failed && <ActivityIndicator color={colors.maroon} style={{ marginTop: space.lg }} />}
        {failed && <Text style={[type.body, { color: colors.muted, textAlign: "center" }]}>Your order is in. We couldn't load its details just now; you'll find it under Orders.</Text>}
        {g && (
          <Animated.View entering={FadeInDown.duration(300)} style={{ alignSelf: "stretch", gap: space.md }}>
            <Text style={[type.small, { textAlign: "center" }]}>Order {g.groupNo}</Text>
            {arrive && <View style={s.eta}><Icon name="zap" size={18} color={colors.maroon} /><Text style={s.etaText}>Arriving by {time(arrive)}</Text></View>}
            {g.deliveryOtp && (
              <View style={s.card}>
                <Text style={type.label}>Delivery code</Text>
                <Text style={s.otp}>{g.deliveryOtp}</Text>
                <Text style={type.small}>Tell this code to the delivery partner when your order arrives.</Text>
              </View>
            )}
            <View style={s.card}>
              <Text style={[type.small, { fontWeight: "800" }]}>Delivering to</Text>
              <Text style={type.body}>{[g.address.line1, g.address.landmark, g.address.locality, g.address.pincode].filter(Boolean).join(", ")}</Text>
            </View>
            {g.paymentMethod === "cod" && (
              <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: space.md }]}>
                <Icon name="dollar-sign" size={22} color={colors.maroon} />
                <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800" }]}>Pay {rupees(g.pricing.total)} on delivery</Text><Text style={type.small}>Cash or UPI to the delivery partner</Text></View>
              </View>
            )}
            {g.children.length > 1 && <Text style={[type.small, { textAlign: "center" }]}>Your order comes in {g.children.length} deliveries.</Text>}
          </Animated.View>
        )}
      </ScrollView>
      <View style={s.bar}>
        {g && g.children[0] && <Button label="Track order" icon="navigation" onPress={() => { router.dismissAll(); router.replace({ pathname: "/tracking/[id]", params: { id: g.children[0]!.id, group: g.id } }); }} />}
        {g && <Button label="View order" variant="soft" onPress={() => { router.dismissAll(); router.replace({ pathname: "/order/[id]", params: { id: g.id } }); }} />}
        <Button label="Continue shopping" onPress={goHome} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  tick: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", ...shadow.lift },
  eta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, backgroundColor: colors.yellowSoft, borderRadius: radius.md, padding: space.md },
  etaText: { fontSize: 15, fontWeight: "900", color: colors.maroon },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, gap: 4, ...shadow.card },
  otp: { fontSize: 40, fontWeight: "900", letterSpacing: 10, color: colors.maroon, marginVertical: 4 },
  bar: { position: "absolute", left: space.xl, right: space.xl, bottom: space.xl, gap: space.sm },
});
