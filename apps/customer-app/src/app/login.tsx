import { router } from "expo-router";
import { useState } from "react";
import { Keyboard, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { requestOtp } from "../api/auth";
import { Button, Header, Icon, KScrollView, Screen, Stagger } from "../components/ui";
import { colors, radius, shadow, type } from "../theme";

/** Screen 5: phone number. Guests can browse; this appears at checkout or from Account. */
export default function Login() {
  const [phone, setPhone] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = /^[6-9]\d{9}$/.test(phone);

  async function send() {
    setBusy(true); setError("");
    try { await requestOtp(phone); Keyboard.dismiss(); router.push({ pathname: "/otp", params: { phone } }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send the code. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <Header back={router.canGoBack()} />
      <View style={{ flex: 1 }}>
        <KScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <Stagger i={0} style={{ alignItems: "center", marginTop: 20 }}>
            <View style={s.mark}><Text style={s.markText}>ds<Text style={{ color: colors.red }}>.</Text></Text></View>
          </Stagger>
          <Stagger i={1}><Text style={[type.title, { marginTop: 28 }]}>Sign in to order</Text></Stagger>
          <Stagger i={2}><Text style={[type.small, { marginTop: 6, marginBottom: 24 }]}>Enter your mobile number. We'll send a 6-digit code to confirm it's you.</Text></Stagger>
          <Stagger i={3}>
            <View style={[s.field, focused && { borderColor: colors.maroon }]}>
              <Text style={s.cc}>+91</Text>
              <View style={s.divider} />
              <TextInput
                value={phone} onChangeText={t => { setPhone(t.replace(/\D/g, "").slice(0, 10)); setError(""); }} placeholder="98000 00010" placeholderTextColor={colors.faint}
                keyboardType="number-pad" maxLength={10} style={s.input} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} accessibilityLabel="Phone number"
              />
              {valid && <Animated.View entering={FadeInDown.duration(350)}><Icon name="check-circle" color={colors.green} size={22} /></Animated.View>}
            </View>
          </Stagger>
          {error ? <Animated.Text entering={FadeInDown.duration(250)} style={s.error}>{error}</Animated.Text> : null}
          <Stagger i={4} style={{ marginTop: 22 }}><Button label={busy ? "Sending…" : "Send code"} icon="arrow-right" disabled={!valid || busy} onPress={() => void send()} /></Stagger>
          <Text style={[type.small, { textAlign: "center", marginTop: 20 }]}>By continuing you agree to our Terms and Privacy Policy.</Text>
        </KScrollView>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  mark: { width: 96, height: 96, borderRadius: 30, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", ...shadow.lift },
  markText: { fontSize: 46, fontWeight: "900", color: colors.maroon, letterSpacing: -3 },
  field: { flexDirection: "row", alignItems: "center", height: 64, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 18, ...shadow.card },
  error: { color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 12, lineHeight: 18 },
  cc: { fontSize: 18, fontWeight: "800", color: colors.ink },
  divider: { width: 1.5, height: 26, backgroundColor: colors.line, marginHorizontal: 14 },
  input: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.ink, letterSpacing: 1, outlineStyle: "none" as never },
});
