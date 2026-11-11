import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { refundMessage, requestRefund } from "../../api/account";
import { ApiError } from "../../api/http";
import { getOrderGroup, type OrderItem } from "../../api/orders";
import { Button, Card, Chip, Header, Icon, Press, Screen } from "../../components/ui";
import { colors, radius, rupees, space, type } from "../../theme";

const REASONS: [string, string][] = [["damaged_item", "Damaged"], ["missing_item", "Missing"], ["other", "Something else"]];

/** Screen 30: report a missing or damaged item from a delivered order. Photo upload arrives with the media screens. */
export default function RefundRequest() {
  const { id, group } = useLocalSearchParams<{ id: string; group: string }>();
  const [items, setItems] = useState<OrderItem[] | null>(null);
  const [orderNo, setOrderNo] = useState("");
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState("damaged_item"); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [done, setDone] = useState(false);

  useEffect(() => {
    void getOrderGroup(group).then(g => { const c = g.children.find(x => x.id === id); setItems(c?.items ?? []); setOrderNo(c?.orderNo ?? g.groupNo); })
      .catch(e => { setItems([]); setErr(e instanceof Error ? e.message : "Couldn't load the order."); });
  }, [id, group]);

  const chosen = Object.keys(picked).filter(k => picked[+k]).map(Number);
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await requestRefund(id, { reason, items: chosen.map(i => ({ orderItemIndex: i, qty: items![i].qty })), ...(note.trim() ? { customerNote: note.trim() } : {}) });
      setDone(true);
    } catch (e) {
      const friendly = e instanceof ApiError ? refundMessage(e.code, e.details?.reason) : "";
      setErr(friendly || (e instanceof Error ? e.message : "Couldn't send your request."));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Screen>
        <View style={s.center}>
          <View style={s.ok}><Icon name="check" size={36} color={colors.white} /></View>
          <Text style={type.title}>Request sent</Text>
          <Text style={[type.small, { textAlign: "center" }]}>We'll review it and update you. You can follow it under My refunds.</Text>
          <Button label="View refunds" onPress={() => router.replace("/refunds")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="Report a problem" subtitle={orderNo} />
      {!items && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
      {items && (
        <>
          <Text style={[type.label, { marginBottom: space.sm }]}>Which items?</Text>
          <View style={{ gap: space.sm }}>
            {items.map((it, i) => (
              <Press key={it.variantId + i} onPress={() => setPicked(p => ({ ...p, [i]: !p[i] }))}>
                <Card style={[{ flexDirection: "row", alignItems: "center", gap: space.md }, picked[i] && { borderWidth: 2, borderColor: colors.maroon }]}>
                  <Icon name={picked[i] ? "check-square" : "square"} size={22} color={picked[i] ? colors.maroon : colors.faint} />
                  <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "700" }]}>{it.qty} × {it.name}</Text><Text style={type.small}>{it.variantLabel}</Text></View>
                  <Text style={[type.body, { fontWeight: "700" }]}>{rupees(it.lineTotal)}</Text>
                </Card>
              </Press>
            ))}
          </View>
          <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>What went wrong?</Text>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            {REASONS.map(([k, l]) => <Chip key={k} label={l} active={reason === k} onPress={() => setReason(k)} />)}
          </View>
          <TextInput value={note} onChangeText={setNote} placeholder="Add a note (optional)" multiline style={s.input} />
        </>
      )}
      {!!err && <Text style={[type.small, { color: colors.red, marginTop: space.md }]}>{err}</Text>}
      <Button label={busy ? "Sending…" : "Send request"} disabled={busy || chosen.length === 0} onPress={() => void submit()} style={{ marginTop: space.xl }} />
      <View style={{ height: space.xl }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  ok: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: colors.white, borderRadius: radius.md, padding: space.md, minHeight: 80, fontSize: 15, color: colors.ink, marginTop: space.md, textAlignVertical: "top" },
});
