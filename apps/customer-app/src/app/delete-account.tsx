import { router } from "expo-router";
import { useState } from "react";
import { Linking, StyleSheet, Text, TextInput, View } from "react-native";
import { requestDeletion } from "../api/account";
import { LEGAL_URLS } from "../api/config";
import { Button, Card, Header, Icon, Press, Screen, SectionTitle } from "../components/ui";
import { useStore } from "../state/store";
import { colors, radius, space, type } from "../theme";

const DELETED = [
  "Your name, phone number and email",
  "Your saved addresses, including any house photo or voice note",
  "Your cart, favourites, notification settings and device tokens",
];
const KEPT = [
  "Order, payment and invoice records, which we must keep for tax and accounting rules. They are no longer linked to your name or phone number once the deletion is finished.",
];

/** Account deletion (required by Google Play): says what happens, then asks for one clear confirmation. */
export default function DeleteAccount() {
  const { signedIn, signOut } = useStore();
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    setBusy(true); setErr("");
    try { await requestDeletion(reason.trim() || undefined); await signOut(); router.replace("/welcome"); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send the request. Please try again."); setBusy(false); }
  };

  return (
    <Screen scroll>
      <Header title="Delete account" />
      {!signedIn ? (
        <Card style={{ gap: space.md }}>
          <Text style={type.h2}>Sign in first</Text>
          <Text style={type.small}>Sign in with the phone number you use for Darjeeling Stores, then open this screen again. You can also read how deletion works on our website.</Text>
          <Button label="Sign in" icon="log-in" onPress={() => router.push("/login")} />
          <Button label="How deletion works" variant="soft" icon="external-link" onPress={() => void Linking.openURL(LEGAL_URLS.deleteAccount)} />
        </Card>
      ) : (
        <>
          <Card style={{ gap: space.sm, borderColor: colors.red, borderWidth: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Icon name="alert-triangle" size={20} color={colors.red} />
              <Text style={[type.h2, { color: colors.red }]}>This can't be undone</Text>
            </View>
            <Text style={type.small}>We will sign you out on every device and delete your account. You won't be able to see your past orders or use your coupons again.</Text>
          </Card>

          <SectionTitle>What we delete</SectionTitle>
          <Card style={{ gap: space.sm }}>
            {DELETED.map(t => <View key={t} style={s.row}><Icon name="check" size={16} color={colors.green} /><Text style={[type.small, { flex: 1 }]}>{t}</Text></View>)}
          </Card>

          <SectionTitle>What we keep</SectionTitle>
          <Card style={{ gap: space.sm }}>
            {KEPT.map(t => <View key={t} style={s.row}><Icon name="file-text" size={16} color={colors.muted} /><Text style={[type.small, { flex: 1 }]}>{t}</Text></View>)}
          </Card>

          <Card style={{ marginTop: space.md, gap: space.sm }}>
            <Text style={type.small}>If an order is still on its way, we finish the deletion after it is delivered.</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder="Why are you leaving? (optional)" placeholderTextColor={colors.faint} style={s.input} maxLength={300} />
            <Press onPress={() => setUnderstood(v => !v)} style={s.row}>
              <View style={[s.box, understood && { backgroundColor: colors.red, borderColor: colors.red }]}>{understood && <Icon name="check" size={14} color={colors.white} />}</View>
              <Text style={[type.small, { flex: 1 }]}>I understand my account will be deleted and this can't be undone.</Text>
            </Press>
            {!!err && <Text style={[type.small, { color: colors.red }]}>{err}</Text>}
            <Button label={busy ? "Sending…" : "Delete my account"} variant="danger" disabled={!understood || busy} onPress={() => void send()} />
            <Button label="Keep my account" variant="soft" onPress={() => router.back()} />
          </Card>
        </>
      )}
      <Press onPress={() => void Linking.openURL(LEGAL_URLS.privacy)} style={{ alignItems: "center", padding: space.lg }}>
        <Text style={[type.small, { color: colors.maroon, fontWeight: "700" }]}>Read our privacy policy</Text>
      </Press>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.faint, alignItems: "center", justifyContent: "center", marginTop: 1 },
  input: { backgroundColor: colors.cream, borderRadius: radius.md, paddingHorizontal: space.md, height: 48, fontSize: 15, color: colors.ink },
});
