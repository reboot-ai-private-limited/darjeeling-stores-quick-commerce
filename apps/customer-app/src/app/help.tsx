import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { getAppConfig } from "../api/app";
import { SUPPORT_PHONE } from "../api/config";
import { Button, Card, Header, Icon, Press, Screen, SectionTitle } from "../components/ui";
import { useStore } from "../state/store";
import { colors, space, type } from "../theme";

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
  const [support, setSupport] = useState<string | null>(SUPPORT_PHONE);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { void getAppConfig(Constants.expoConfig?.version ?? "0.0.0").then(c => setSupport(c.supportNumber ?? SUPPORT_PHONE)).catch(() => undefined); }, []);

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
            <Press onPress={() => router.push("/delete-account")} style={{ alignItems: "center", padding: space.sm }}><Text style={{ color: colors.red, fontWeight: "700" }}>Delete my account</Text></Press>
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
});
