import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, TextInput, View } from "react-native";
import { requestDeletion } from "../api/account";
import { getAppConfig } from "../api/app";
import { Button, Card, Header, Icon, Press, Screen, SectionTitle } from "../components/ui";
import { useStore } from "../state/store";
import { colors, radius, space, type } from "../theme";

const FAQS: [string, string][] = [
  ["How long does delivery take?", "Most orders arrive within the time shown at checkout. You can follow your delivery partner live from the order screen."],
  ["Can I cancel my order?", "Yes, until the store starts packing it. Open the order and tap Cancel order. Prepaid orders are refunded."],
  ["An item was missing or damaged", "After delivery, open the order and tap Report a problem. Choose the item and we'll review it."],
  ["How do I pay?", "Pay in cash when your order arrives, or pay online with UPI, card or netbanking."],
  ["What is the delivery code?", "A 4-digit code shown on your order. Tell it to the delivery partner at your door so the right person gets your order."],
];

/** Screen 37: support contact, FAQs, account deletion and sign out. */
export default function Help() {
  const { signedIn, signOut } = useStore();
  const [support, setSupport] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { void getAppConfig(Constants.expoConfig?.version ?? "0.0.0").then(c => setSupport(c.supportNumber ?? null)).catch(() => undefined); }, []);

  const deleteAccount = async () => {
    setBusy(true); setErr("");
    try { await requestDeletion(reason.trim() || undefined); await signOut(); router.replace("/welcome"); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send the request."); setBusy(false); }
  };

  return (
    <Screen scroll>
      <Header title="Help & support" />
      <Card style={{ gap: space.sm }}>
        <Text style={type.h2}>Need a hand?</Text>
        <Text style={type.small}>Call or message us about an order, a payment or anything else.</Text>
        {support ? (
          <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
            <Button label="Call us" icon="phone" style={{ flex: 1 }} onPress={() => void Linking.openURL(`tel:${support}`)} />
            <Button label="WhatsApp" icon="message-circle" variant="soft" style={{ flex: 1 }} onPress={() => void Linking.openURL(`https://wa.me/${support.replace(/\D/g, "")}`)} />
          </View>
        ) : <Text style={type.small}>Support details are loading.</Text>}
      </Card>

      <SectionTitle>Common questions</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {FAQS.map(([q, a], i) => (
          <Press key={q} onPress={() => setOpen(open === i ? null : i)} style={[s.faq, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text style={[type.body, { flex: 1, fontWeight: "700" }]}>{q}</Text>
              <Icon name={open === i ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
            </View>
            {open === i && <Text style={[type.small, { marginTop: 6 }]}>{a}</Text>}
          </Press>
        ))}
      </Card>

      {signedIn && (
        <>
          <SectionTitle>Account</SectionTitle>
          <Card style={{ gap: space.sm }}>
            <Button label="Sign out" variant="ghost" icon="log-out" onPress={() => void signOut().then(() => router.replace("/welcome"))} />
            {!confirming ? (
              <Press onPress={() => setConfirming(true)} style={{ alignItems: "center", padding: space.sm }}><Text style={{ color: colors.red, fontWeight: "700" }}>Delete my account</Text></Press>
            ) : (
              <View style={{ gap: space.sm }}>
                <Text style={type.small}>This signs you out everywhere and asks us to delete your account and data. It can't be undone once we finish.</Text>
                <TextInput value={reason} onChangeText={setReason} placeholder="Reason (optional)" style={s.input} />
                {!!err && <Text style={[type.small, { color: colors.red }]}>{err}</Text>}
                <Button label={busy ? "Sending…" : "Yes, delete my account"} variant="danger" disabled={busy} onPress={() => void deleteAccount()} />
                <Button label="Keep my account" variant="soft" onPress={() => setConfirming(false)} />
              </View>
            )}
          </Card>
        </>
      )}
      <Text style={[type.small, { textAlign: "center", marginTop: space.xl }]}>Version {Constants.expoConfig?.version ?? "0.0.0"}</Text>
      <View style={{ height: space.xl }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  faq: { padding: space.lg },
  input: { backgroundColor: colors.cream, borderRadius: radius.md, paddingHorizontal: space.md, height: 48, fontSize: 15, color: colors.ink },
});
