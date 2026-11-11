import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { ApiError } from "../../api/http";
import { deliver, verifyDeliveryOtp, type OrderDetail } from "../../api/rider";
import { OrderGate } from "../../components/OrderGate";
import { Keypad, OtpBoxes } from "../../components/OtpPad";
import { Button, Header, Icon, Screen, Stagger, tap } from "../../components/ui";
import { useStore } from "../../state/store";
import { currentFix, isCod, useOrderDetail } from "../../state/useOrderDetail";
import { colors, type } from "../../theme";

const LEN = 4;

/** Marks the order delivered. "Already delivered" from the server counts as success. */
export async function finishDelivery(o: OrderDetail, otp: string | null) {
  const fix = await currentFix();
  try { await deliver(o.id, otp, fix?.location ?? null, fix?.accuracyM ?? null); }
  catch (e) { if (!(e instanceof ApiError && e.code === "CONFLICT" && e.details?.reason !== "collection_required")) throw e; }
}

/** The customer reads out a code; entering it proves the order reached the right person. */
export default function Arrived() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { rememberOtp, refresh } = useStore();
  const { detail: o, error, loading, reload } = useOrderDetail(id);
  const [code, setCode] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  if (!o) return <OrderGate title="Delivery code" loading={loading} error={error} onRetry={() => void reload()} />;

  async function proceed(otp: string | null) {
    if (!o) return;
    if (otp) rememberOtp(o.id, otp);
    if (isCod(o)) { router.replace({ pathname: "/order/payment", params: { id: o.id } }); return; }
    await finishDelivery(o, otp);
    await refresh().catch(() => undefined);
    router.replace({ pathname: "/order/delivered", params: { no: o.orderNo, amount: "0", method: "prepaid" } });
  }

  async function check(full: string) {
    if (!o) return;
    setBusy(true); setMessage("");
    try {
      const wrong = await verifyDeliveryOtp(o.id, full);
      if (wrong) {
        tap("medium"); setErrorKey(e => e + 1);
        setMessage(wrong.attemptsLeft !== undefined ? `Wrong code. ${wrong.attemptsLeft} ${wrong.attemptsLeft === 1 ? "try" : "tries"} left.` : "Wrong code. Ask the customer again.");
        setTimeout(() => setCode(""), 520);
        return;
      }
      tap("success"); setOk(true);
      await proceed(full);
    } catch (e) { setOk(false); setMessage(e instanceof Error ? e.message : "Something went wrong. Please try again."); setCode(""); }
    finally { setBusy(false); }
  }

  function press(k: string) {
    if (ok || busy) return;
    setMessage("");
    if (k === "⌫") return setCode(c => c.slice(0, -1));
    if (code.length >= LEN) return;
    const next = code + k;
    setCode(next);
    if (next.length === LEN) setTimeout(() => void check(next), 160);
  }

  if (!o.otpRequired) return (
    <Screen>
      <Header title="Hand over" subtitle={`${o.orderNo} · ${o.customer.name}`} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
        <Text style={type.title}>No code needed</Text>
        <Text style={[type.small, { textAlign: "center", paddingHorizontal: 30 }]}>Hand the order to the customer, then continue.</Text>
        {message ? <Text style={{ color: colors.red, fontWeight: "700", textAlign: "center" }}>{message}</Text> : null}
      </View>
      <Button label={busy ? "Please wait…" : "Continue"} icon="arrow-right" disabled={busy} onPress={async () => { setBusy(true); setMessage(""); try { await proceed(null); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not continue."); } finally { setBusy(false); } }} />
    </Screen>
  );

  return (
    <Screen>
      <Header title="Delivery code" subtitle={`${o.orderNo} · ${o.customer.name}`} back={!ok} />
      <Stagger i={0} style={{ alignItems: "center", marginTop: 16 }}>
        <View style={{ width: 76, height: 76, borderRadius: 26, backgroundColor: ok ? colors.greenSoft : colors.yellowSoft, alignItems: "center", justifyContent: "center" }}>
          {ok ? <Animated.View entering={ZoomIn.duration(220)}><Icon name="check" size={38} color={colors.green} /></Animated.View> : <Icon name="lock" size={30} color={colors.maroon} />}
        </View>
        <Text style={[type.title, { marginTop: 16 }]}>{ok ? "Code matched" : "Ask for the code"}</Text>
        <Text style={[type.small, { marginTop: 6, textAlign: "center", paddingHorizontal: 20 }]}>{ok ? "One moment…" : "The customer sees a 4-digit code in their app. Type it in below."}</Text>
      </Stagger>
      <Stagger i={1} style={{ marginTop: 28 }}><OtpBoxes value={code} length={LEN} errorKey={errorKey} /></Stagger>
      <View style={{ minHeight: 40, marginTop: 14, alignItems: "center", paddingHorizontal: 20 }}>
        {busy && !ok ? <Text style={type.small}>Checking…</Text> : message ? <Animated.Text entering={FadeIn} style={{ color: colors.red, fontWeight: "700", fontSize: 13, textAlign: "center" }}>{message}</Animated.Text> : null}
      </View>
      <View style={{ flex: 1 }} />
      <Stagger i={2}><Keypad onKey={press} /></Stagger>
    </Screen>
  );
}
