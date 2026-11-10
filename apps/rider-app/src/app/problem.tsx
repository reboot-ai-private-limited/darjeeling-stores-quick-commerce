import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { reportProblem, type ProblemType } from "../api/rider";
import { Button, Card, Chip, Icon, Screen, Stagger } from "../components/ui";
import { PROBLEM_REASONS } from "../reasons";
import { useStore } from "../state/store";
import { colors, type } from "../theme";

/**
 * Tell the store about a problem. The API attaches a problem to an order, so this needs a current delivery:
 * it uses the order it was opened from, or the rider's active order.
 */
export default function Problem() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { active, order } = useStore();
  const target = (id ? order(id) : undefined) ?? active;
  const [reason, setReason] = useState<ProblemType | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!target || !reason) return;
    setBusy(true); setFailure("");
    try { await reportProblem(target.id, reason, note.trim() || null); setSent(true); }
    catch (e) { setFailure(e instanceof Error ? e.message : "Could not send the report."); }
    finally { setBusy(false); }
  }

  if (sent) return (
    <Screen><View style={s.center}>
      <Animated.View entering={ZoomIn.duration(220)} style={s.ok}><Icon name="check" size={42} color={colors.green} /></Animated.View>
      <Animated.Text entering={FadeIn.delay(200)} style={type.title}>Store notified</Animated.Text>
      <Animated.Text entering={FadeIn.delay(300)} style={[type.small, { textAlign: "center", paddingHorizontal: 36 }]}>Your manager has been alerted and will decide what to do. Stay safe.</Animated.Text>
      <View style={{ marginTop: 18, alignSelf: "stretch" }}><Button label="Done" onPress={() => router.back()} /></View>
    </View></Screen>
  );

  if (!target) return (
    <Screen><View style={s.center}>
      <View style={s.badge}><Icon name="phone" size={26} color={colors.red} /></View>
      <Text style={type.title}>No active delivery</Text>
      <Text style={[type.small, { textAlign: "center", paddingHorizontal: 30 }]}>Problems are reported on a delivery. You don't have one right now, so please call your manager directly.</Text>
      <View style={{ marginTop: 18, alignSelf: "stretch" }}><Button label="Close" variant="ghost" onPress={() => router.back()} /></View>
    </View></Screen>
  );

  return (
    <Screen scroll bottomPad={30}>
      <View style={s.grab} />
      <Stagger i={0} style={{ marginTop: 6 }}>
        <View style={s.badge}><Icon name="alert-circle" size={26} color={colors.red} /></View>
        <Text style={[type.title, { marginTop: 14 }]}>Report a problem</Text>
        <Text style={[type.small, { marginTop: 6 }]}>About {target.orderNo}. This alerts your manager straight away.</Text>
      </Stagger>
      <Stagger i={1} style={s.chips}>{PROBLEM_REASONS.map(r => <Chip key={r.value} label={r.label} active={reason === r.value} onPress={() => setReason(r.value)} />)}</Stagger>
      <Stagger i={2}><Card style={{ marginTop: 18, padding: 4 }}><TextInput value={note} onChangeText={setNote} maxLength={500} placeholder="Tell us more (optional)" placeholderTextColor={colors.faint} multiline style={s.note} /></Card></Stagger>
      {failure ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 14 }}>{failure}</Text> : null}
      <Stagger i={3} style={{ marginTop: 22, gap: 10 }}>
        <Button label={busy ? "Sending…" : "Alert the store"} variant="danger" icon="send" disabled={!reason || busy} onPress={() => void submit()} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  grab: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginTop: 10 },
  badge: { width: 56, height: 56, borderRadius: 20, backgroundColor: colors.redSoft, alignItems: "center", justifyContent: "center", marginTop: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 22 },
  note: { minHeight: 90, padding: 14, fontSize: 15, color: colors.ink, textAlignVertical: "top", outlineStyle: "none" as never },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  ok: { width: 92, height: 92, borderRadius: 32, backgroundColor: colors.greenSoft, alignItems: "center", justifyContent: "center" },
});
