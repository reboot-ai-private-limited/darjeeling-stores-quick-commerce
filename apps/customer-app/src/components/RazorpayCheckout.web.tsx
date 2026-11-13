import { Text, View } from "react-native";
import type { CheckoutData } from "../api/payments";
import { colors, space, type } from "../theme";

export type CheckoutEvent = { type: "success"; data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string } } | { type: "failed"; reason: string } | { type: "dismissed" } | { type: "returned" } | { type: "error"; reason: string };

/** The browser preview can't host the in-app checkout. Use the phone to pay. */
export function RazorpayCheckout(_: { data: CheckoutData; prefill: { name?: string; phone?: string }; onEvent: (e: CheckoutEvent) => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, backgroundColor: colors.cream }}>
      <Text style={[type.small, { textAlign: "center" }]}>Online payment opens inside the phone app. Open this order on your phone to pay.</Text>
    </View>
  );
}
