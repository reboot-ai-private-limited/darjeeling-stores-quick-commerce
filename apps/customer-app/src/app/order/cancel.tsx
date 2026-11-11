import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { cancelOrder, refundMessage } from "../../api/account";
import { ApiError } from "../../api/http";
import { Button, Card, Chip, Header, Icon, Screen } from "../../components/ui";
import { colors, radius, rupees, space, type } from "../../theme";

const REASONS = ["Ordered by mistake", "Want to change items", "Delivery is taking too long", "Found a better price", "Other"];

/** Screen 29: cancel an order that hasn't started packing. Shows the refund for prepaid orders. */
export default function CancelOrder() {
  const { id, orderNo } = useLocalSearchParams<{ id: string; orderNo?: string }>();
  const [reason, setReason] = useState(REASONS[0]); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [done, setDone] = useState<{ refund: number | null } | null>(null);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const text = reason === "Other" && note.trim() ? note.trim() : reason;
      const r = await cancelOrder(id, text);
      setDone({ refund: r.refund?.amount ?? null });
    } catch (e) {
      const friendly = e instanceof ApiError ? refundMessage(e.code, e.details?.reason) : "";
      setErr(friendly || (e instanceof Error ? e.message : "Couldn't cancel. Please try again."));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Screen>
        <View style={s.center}>
          <View style={s.ok}><Icon name="check" size={36} color={colors.white} /></View>
          <Text style={type.title}>Order cancelled</Text>
          <Text style={[type.small, { textAlign: "center" }]}>
            {done.refund ? `We'll refund ${rupees(done.refund)} to your original payment method.` : "Nothing was charged, so there's nothing to refund."}
          </Text>
          {done.refund ? <Button label="View refunds" variant="soft" onPress={() => router.replace("/refunds")} /> : null}
          <Button label="Back to orders" onPress={() => router.dismissTo("/orders")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="Cancel order" subtitle={orderNo} />
      <Card style={{ gap: space.md }}>
        <Text style={type.h2}>Why are you cancelling?</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {REASONS.map(r => <Chip key={r} label={r} active={reason === r} onPress={() => setReason(r)} />)}
        </View>
        {reason === "Other" && <TextInput value={note} onChangeText={setNote} placeholder="Tell us more" multiline style={s.input} />}
        <Text style={type.small}>You can cancel until the store starts packing. Prepaid orders are refunded.</Text>
      </Card>
      {!!err && <Text style={[type.small, { color: colors.red, marginTop: space.md }]}>{err}</Text>}
      <View style={{ gap: space.sm, marginTop: space.xl }}>
        <Button label={busy ? "Cancelling…" : "Cancel this order"} variant="danger" disabled={busy} onPress={() => void submit()} />
        <Button label="Keep my order" variant="soft" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  ok: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: colors.cream, borderRadius: radius.md, padding: space.md, minHeight: 80, fontSize: 15, color: colors.ink, textAlignVertical: "top" },
});
