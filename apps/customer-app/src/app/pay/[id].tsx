import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { getPaymentStatus, paymentMessage, retryPayment, verifyPayment, type CheckoutData } from "../../api/payments";
import { RazorpayCheckout, type CheckoutEvent } from "../../components/RazorpayCheckout";
import { Button, Header, Icon, Screen } from "../../components/ui";
import { tap } from "../../components/ui";
import { colors, space, type } from "../../theme";
import { getMe } from "../../api/auth";

type Phase = "loading" | "checkout" | "confirming" | "slow" | "failed" | "expired";

/** Screens 23-24: pay online, wait while the server confirms, and retry if the payment didn't go through. Only the server's webhook confirms an order. */
export default function Pay() {
  const { id, key, rzp, amount, exp } = useLocalSearchParams<{ id: string; key?: string; rzp?: string; amount?: string; exp?: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<CheckoutData | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [msg, setMsg] = useState("");
  const [prefill, setPrefill] = useState<{ name?: string; phone?: string }>({});
  const alive = useRef(true);
  const handled = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { void getMe().then(m => setPrefill({ name: m.name, phone: m.phone })).catch(() => undefined); }, []);

  const start = useCallback(async (fresh: boolean) => {
    setPhase("loading"); setMsg(""); handled.current = false;
    try {
      const d: CheckoutData = !fresh && key && rzp && amount
        ? { razorpayKeyId: key, razorpayOrderId: rzp, amount: Number(amount), currency: "INR", expiresAt: exp ?? "" }
        : await retryPayment(id);
      if (!alive.current) return;
      setData(d); setAttempt(a => a + 1); setPhase("checkout");
    } catch (e) {
      if (!alive.current) return;
      setMsg(paymentMessage(e));
      setPhase(/ended and this order was cancelled/.test(paymentMessage(e)) ? "expired" : "failed");
    }
  }, [id, key, rzp, amount, exp]);
  useEffect(() => { void start(false); }, [start]);

  /** Asks the server every 3 seconds, for about a minute, whether the webhook has confirmed the payment. */
  const confirm = useCallback(async () => {
    setPhase("confirming");
    for (let i = 0; i < 20 && alive.current; i++) {
      try {
        const s = await getPaymentStatus(id);
        if (s.state === "confirmed") { tap("success"); router.replace({ pathname: "/order-placed", params: { id } }); return; }
        if (s.state === "expired") { setMsg("The payment window ended and this order was cancelled."); setPhase("expired"); return; }
        if (s.state === "failed") { setMsg("The payment didn't go through."); setPhase("failed"); return; }
      } catch { /* keep trying */ }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (alive.current) setPhase("slow");
  }, [id]);

  const onEvent = async (e: CheckoutEvent) => {
    if (handled.current) return;
    if (e.type === "success") {
      handled.current = true;
      try { await verifyPayment(id, e.data); } catch (err) { setMsg(paymentMessage(err)); }
      void confirm();
    } else if (e.type === "returned") {
      // Back from the bank or card page: the server (webhook) decides whether it worked.
      handled.current = true;
      void confirm();
    } else if (e.type === "failed") { handled.current = true; setMsg(e.reason); setPhase("failed"); }
    else if (e.type === "dismissed") { handled.current = true; setMsg("Payment was cancelled."); setPhase("failed"); }
    else { handled.current = true; setMsg("Couldn't open the payment page. Check your internet connection."); setPhase("failed"); }
  };

  const viewOrder = () => router.replace({ pathname: "/order/[id]", params: { id } });

  if (phase === "checkout" && data) {
    return (
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title="Pay securely" subtitle="Your order is held for a few minutes" /></View>
        <RazorpayCheckout key={attempt} data={data} prefill={prefill} onEvent={e => void onEvent(e)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={s.center}>
        {phase === "loading" && <><ActivityIndicator color={colors.maroon} size="large" /><Text style={type.small}>Getting your payment ready…</Text></>}
        {phase === "confirming" && <><ActivityIndicator color={colors.maroon} size="large" /><Text style={type.h2}>Confirming your payment…</Text><Text style={[type.small, { textAlign: "center" }]}>Please don't close the app. This usually takes a few seconds.</Text></>}
        {phase === "slow" && (
          <>
            <View style={[s.icon, { backgroundColor: colors.amberSoft }]}><Icon name="clock" size={34} color={colors.amber} /></View>
            <Text style={type.h2}>Still confirming</Text>
            <Text style={[type.small, { textAlign: "center" }]}>We'll notify you once the payment is confirmed. You can check the order any time.</Text>
            <Button label="View my order" onPress={viewOrder} style={s.btn} />
          </>
        )}
        {phase === "failed" && (
          <>
            <View style={[s.icon, { backgroundColor: colors.redSoft }]}><Icon name="x" size={34} color={colors.red} /></View>
            <Text style={type.h2}>Payment not completed</Text>
            <Text style={[type.small, { textAlign: "center" }]}>{msg || "Something went wrong."}{!msg || /[.!?]$/.test(msg) ? "" : "."} Your order is kept for a few minutes so you can try again.</Text>
            <Button label="Try again" icon="refresh-cw" onPress={() => void start(true)} style={s.btn} />
            <Button label="View my order" variant="soft" onPress={viewOrder} style={s.btn} />
          </>
        )}
        {phase === "expired" && (
          <>
            <View style={[s.icon, { backgroundColor: colors.redSoft }]}><Icon name="slash" size={34} color={colors.red} /></View>
            <Text style={type.h2}>Order expired</Text>
            <Text style={[type.small, { textAlign: "center" }]}>{msg || "The payment window ended and this order was cancelled."} If money was taken, it will be refunded.</Text>
            <Button label="Back to shopping" onPress={() => { router.dismissAll(); router.replace("/home"); }} style={s.btn} />
          </>
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  icon: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  btn: { alignSelf: "stretch" },
});
