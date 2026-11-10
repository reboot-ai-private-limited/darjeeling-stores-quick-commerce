import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { Confetti, SuccessCheck, useCountUp } from "../../components/effects";
import { Button, Card, Row, Screen, tap } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, rupees, type } from "../../theme";

export default function Delivered() {
  const { no = "", amount = "0", method = "prepaid" } = useLocalSearchParams<{ no?: string; amount?: string; method?: string }>();
  const { width } = useWindowDimensions();
  const { active, deliveredToday, cashInHand } = useStore();
  const paise = Number(amount) || 0;
  const shown = useCountUp(paise / 100, 900);
  useEffect(() => { tap("success"); }, []);

  return (
    <Screen dark scroll>
      <Confetti width={width} />
      <View style={{ alignItems: "center", marginTop: 70 }}>
        <SuccessCheck size={132} />
        <Animated.Text entering={FadeInUp.delay(450).duration(350)} style={{ color: colors.white, fontSize: 36, fontWeight: "900", letterSpacing: -1, marginTop: 28 }}>Delivered!</Animated.Text>
        <Animated.Text entering={FadeInUp.delay(560).duration(350)} style={{ color: "rgba(255,255,255,0.7)", fontWeight: "700", marginTop: 6 }}>{no} · great work</Animated.Text>
      </View>
      <Animated.View entering={FadeInDown.delay(700).duration(350)} style={{ marginTop: 38 }}>
        <Card>
          <Row icon="check-circle" label="Deliveries today" value={String(deliveredToday)} />
          <Row icon="credit-card" label="Payment" value={method === "cash" ? "Cash" : method === "upi" ? "UPI (to be checked)" : "Prepaid"} />
          {paise > 0 && method === "cash" && <Row icon="dollar-sign" label="Cash collected" value={`₹${shown.toLocaleString("en-IN")}`} tone={colors.green} />}
        </Card>
        {method === "cash" && <Text style={[type.small, { color: "rgba(255,255,255,0.6)", textAlign: "center", marginTop: 12 }]}>Cash in hand is now {rupees(cashInHand)}</Text>}
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(850).duration(350)} style={{ marginTop: 28, gap: 12 }}>
        {active
          ? <Button label="Next delivery" icon="arrow-right" variant="accent" onPress={() => router.replace({ pathname: "/order/[id]", params: { id: active.id } })} />
          : <Button label="Back to home" icon="home" variant="accent" onPress={() => router.replace("/(tabs)")} />}
        {active && <Button label="Back to home" variant="ghost" style={{ borderColor: "rgba(255,255,255,0.25)" }} onPress={() => router.replace("/(tabs)")} />}
      </Animated.View>
    </Screen>
  );
}
