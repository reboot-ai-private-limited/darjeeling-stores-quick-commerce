import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { requestOtp, verifyOtp } from "../api/auth";
import { Keypad, OtpBoxes } from "../components/OtpPad";
import { Header, Icon, Press, Screen, Stagger, tap } from "../components/ui";
import { useStore } from "../state/store";
import { colors, type } from "../theme";

const LEN = 6;

/** Screen 6: the 6-digit code. Submits by itself, shakes on a wrong code, and lets the customer resend after 30 seconds. */
export default function Otp() {
  const { phone = "" } = useLocalSearchParams<{ phone?: string }>();
  const { onSignedIn } = useStore();
  const [code, setCode] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [wait, setWait] = useState(30);

  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  async function check(full: string) {
    setBusy(true); setMessage("");
    try {
      const r = await verifyOtp(phone, full);
      if (r.wrong) {
        tap("medium"); setErrorKey(e => e + 1);
        setMessage(r.attemptsLeft !== undefined ? `That code isn't right. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left.` : "That code isn't right. Try again.");
        setTimeout(() => setCode(""), 520);
        return;
      }
      onSignedIn();
      tap("success"); setOk(true);
      // New customers tell us their name; returning ones go back to what they were doing.
      setTimeout(() => { if (r.isNewUser) router.replace("/name"); else { router.dismissAll(); router.replace("/home"); } }, 700);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setCode("");
    } finally { setBusy(false); }
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

  async function resend() {
    if (wait > 0) return;
    try { await requestOtp(phone); setWait(30); setMessage("A new code has been sent."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not resend the code."); }
  }

  return (
    <Screen>
      <Header title="Verify" />
      <Stagger i={0} style={{ alignItems: "center", marginTop: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: ok ? colors.greenSoft : colors.yellowSoft, alignItems: "center", justifyContent: "center" }}>
          {ok ? <Animated.View entering={ZoomIn.duration(220)}><Icon name="check" size={34} color={colors.green} /></Animated.View> : <Icon name="message-square" size={30} color={colors.maroon} />}
        </View>
        <Text style={[type.title, { marginTop: 18 }]}>Enter the code</Text>
        <Text style={[type.small, { marginTop: 6, textAlign: "center" }]}>Sent to +91 {phone.replace(/(\d{5})(\d{5})/, "$1 $2")}</Text>
      </Stagger>
      <Stagger i={1} style={{ marginTop: 30 }}><OtpBoxes value={code} length={LEN} errorKey={errorKey} /></Stagger>
      <View style={{ minHeight: 44, marginTop: 14, alignItems: "center", paddingHorizontal: 20 }}>
        {busy ? <Text style={type.small}>Checking…</Text>
          : message ? <Animated.Text entering={FadeIn} style={{ color: message.startsWith("A new code") ? colors.green : colors.red, fontWeight: "700", fontSize: 13, textAlign: "center" }}>{message}</Animated.Text>
          : wait > 0 ? <Text style={type.small}>{`Resend code in 0:${String(wait).padStart(2, "0")}`}</Text>
          : <Press onPress={() => void resend()} haptic><Text style={{ color: colors.maroon, fontWeight: "800", fontSize: 13 }}>Didn't get it? Resend code</Text></Press>}
      </View>
      <View style={{ flex: 1 }} />
      <Stagger i={3}><Keypad onKey={press} /></Stagger>
    </Screen>
  );
}
