import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { updateMe } from "../api/auth";
import { Button, Icon, Screen } from "../components/ui";
import { colors, radius, shadow, space, type } from "../theme";

/** Screen 7: first sign-in only. We ask for a name (and an optional email) so the rider and receipts can use it. */
export default function Name() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const validEmail = email === "" || /^\S+@\S+\.\S+$/.test(email);
  const ok = name.trim().length >= 2 && validEmail;

  const finish = () => { router.dismissAll(); router.replace("/home"); };
  async function save() {
    setBusy(true); setError("");
    try { await updateMe({ name: name.trim(), ...(email ? { email: email.trim() } : {}) }); finish(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <Screen scroll>
      <View style={{ alignItems: "center", marginTop: space.xxl }}>
        <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" }}><Icon name="user" size={38} color={colors.maroon} /></View>
        <Text style={[type.title, { marginTop: space.lg }]}>What should we call you?</Text>
        <Text style={[type.small, { marginTop: 6, textAlign: "center" }]}>Your name helps the delivery partner find you.</Text>
      </View>
      <View style={{ gap: space.md, marginTop: space.xl }}>
        <TextInput value={name} onChangeText={t => { setName(t); setError(""); }} placeholder="Your name" placeholderTextColor={colors.faint} autoCapitalize="words" style={s.input} maxLength={60} accessibilityLabel="Name" />
        <TextInput value={email} onChangeText={setEmail} placeholder="Email (optional)" placeholderTextColor={colors.faint} autoCapitalize="none" keyboardType="email-address" style={[s.input, !validEmail && { borderColor: colors.red }]} accessibilityLabel="Email" />
        {!validEmail && <Text style={[type.small, { color: colors.red }]}>That email doesn't look right.</Text>}
        {error ? <Text style={[type.small, { color: colors.red }]}>{error}</Text> : null}
        <Button label={busy ? "Saving…" : "Continue"} icon="arrow-right" disabled={!ok || busy} onPress={() => void save()} />
        <Button label="Skip for now" variant="ghost" onPress={finish} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { height: 60, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 18, fontSize: 17, fontWeight: "600", color: colors.ink, ...shadow.card },
});
