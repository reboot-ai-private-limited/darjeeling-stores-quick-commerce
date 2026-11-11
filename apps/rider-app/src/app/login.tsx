import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, { FadeInDown, interpolate, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { requestOtp } from "../api/rider";
import { Button, Icon, Stagger } from "../components/ui";
import { smooth } from "../motion";
import { colors, radius, shadow, type } from "../theme";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [focused, setFocused] = useState(false);
  const valid = phone.length === 10;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true); setError("");
    try { await requestOtp(phone); Keyboard.dismiss(); router.push({ pathname: "/otp", params: { phone } }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send the code. Please try again."); }
    finally { setBusy(false); }
  }
  const { height } = useWindowDimensions();

  // When the keyboard opens, the tall header folds away so the field and the Send button stay in view.
  const kb = useSharedValue(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => { kb.value = smooth(1, 220); });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => { kb.value = smooth(0, 220); });
    return () => { show.remove(); hide.remove(); };
  }, [kb]);
  const heroStyle = useAnimatedStyle(() => ({ height: interpolate(kb.value, [0, 1], [height * 0.42, 120]) }));
  // The title block is 96px tall (two 34px lines plus spacing), so its container must be at least that or the first line is clipped.
  const titleStyle = useAnimatedStyle(() => ({ opacity: interpolate(kb.value, [0, 0.6], [1, 0], "clamp"), height: interpolate(kb.value, [0, 1], [96, 0]) }));
  const bikeStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(kb.value, [0, 1], [1, 0.6]) }], marginVertical: interpolate(kb.value, [0, 1], [0, -18]) }));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.cream }}>
      <Animated.View style={[s.hero, heroStyle]}>
        <LinearGradient colors={[colors.maroon, colors.maroonSoft]} style={StyleSheet.absoluteFill} />
        <View style={s.dotA} /><View style={s.dotB} />
        <Animated.View style={[s.bike, bikeStyle]}><Icon name="navigation" size={54} color={colors.maroon} /></Animated.View>
        <Animated.View style={[{ overflow: "hidden", alignSelf: "stretch", justifyContent: "flex-end" }, titleStyle]}>
          <Text style={s.heroTitle}>Ride. Deliver.{"\n"}Repeat.</Text>
        </Animated.View>
      </Animated.View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.sheet} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Stagger i={0}><Text style={type.title}>Welcome back</Text></Stagger>
        <Stagger i={1}><Text style={[type.small, { marginTop: 6, marginBottom: 24 }]}>Enter the phone number your manager registered for you. We'll send a code.</Text></Stagger>
        <Stagger i={2}>
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
        <Stagger i={3} style={{ marginTop: 22 }}><Button label={busy ? "Sending…" : "Send code"} icon="arrow-right" disabled={!valid || busy} onPress={() => void send()} /></Stagger>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", justifyContent: "center", borderBottomLeftRadius: 44, borderBottomRightRadius: 44, overflow: "hidden" },
  dotA: { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(255,201,51,0.10)", top: -60, left: -60 },
  dotB: { position: "absolute", width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(255,255,255,0.06)", bottom: -30, right: -30 },
  heroTitle: { marginTop: 16, color: colors.white, fontSize: 28, fontWeight: "900", textAlign: "center", letterSpacing: -0.8, lineHeight: 34 },
  bike: { width: 100, height: 100, borderRadius: 32, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", ...shadow.lift },
  sheet: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 24 },
  field: { flexDirection: "row", alignItems: "center", height: 64, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 18, ...shadow.card },
  error: { color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 12, lineHeight: 18 },
  cc: { fontSize: 18, fontWeight: "800", color: colors.ink },
  divider: { width: 1.5, height: 26, backgroundColor: colors.line, marginHorizontal: 14 },
  input: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.ink, letterSpacing: 1, outlineStyle: "none" as never },
});
