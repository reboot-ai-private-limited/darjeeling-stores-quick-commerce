import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { listRefunds, REFUND_REASON, type Refund } from "../api/account";
import { Button, Card, Header, Icon, Pill, Screen } from "../components/ui";
import { colors, rupees, space, type } from "../theme";

const TONE = { requested: ["Requested", "amber"], approved: ["Approved", "blue"], done: ["Refunded", "green"], rejected: ["Rejected", "red"] } as const;
const METHOD: Record<string, string> = { razorpay_dashboard: "to your original payment method", upi: "by UPI", cash: "in cash" };

/** Screen 31: status of every refund, straight from the server. */
export default function Refunds() {
  const [rows, setRows] = useState<Refund[] | null>(null); const [err, setErr] = useState("");
  const load = () => { setErr(""); void listRefunds().then(setRows).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load refunds.")); };
  useEffect(load, []);
  return (
    <Screen scroll>
      <Header title="My refunds" />
      {!rows && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
      {!!err && <View style={{ alignItems: "center", gap: space.md, marginTop: 60 }}><Text style={type.small}>{err}</Text><Button label="Try again" variant="soft" onPress={load} /></View>}
      {rows?.length === 0 && (
        <View style={{ alignItems: "center", gap: space.sm, marginTop: 80 }}>
          <Icon name="check-circle" size={40} color={colors.faint} /><Text style={type.h2}>No refunds</Text>
          <Text style={type.small}>Refunds for cancelled or problem orders show up here.</Text>
        </View>
      )}
      <View style={{ gap: space.md }}>
        {rows?.map(r => {
          const [label, tone] = TONE[r.status];
          return (
            <Card key={r.id} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={[type.h2, { flex: 1 }]}>{rupees(r.amount)}</Text><Pill label={label.toUpperCase()} tone={tone} /></View>
              <Text style={type.body}>{r.orderNo} · {REFUND_REASON[r.reason] ?? r.reason}</Text>
              <Text style={type.small}>{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Text>
              {r.status === "done" && r.method && <Text style={[type.small, { color: colors.green }]}>Paid {METHOD[r.method] ?? ""}</Text>}
              {r.status === "rejected" && r.rejectReason && <Text style={[type.small, { color: colors.red }]}>{r.rejectReason}</Text>}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
