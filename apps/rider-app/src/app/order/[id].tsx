import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { getMediaUrl, stageOf } from "../../api/rider";
import { OrderGate } from "../../components/OrderGate";
import { VoiceNote } from "../../components/VoiceNote";
import { Button, Card, Header, Icon, Pill, Press, Row, Screen, SectionTitle, Stagger } from "../../components/ui";
import { isCod, useOrderDetail } from "../../state/useOrderDetail";
import { colors, radius, rupees, type } from "../../theme";

const STEPS = ["Assigned", "Picked up", "On the way", "At door"] as const;
const STEP_INDEX = { assigned: 0, picked_up: 1, out_for_delivery: 2, arrived: 3, delivered: 3, failed: 3 } as const;
const NEXT = { assigned: ["Pick up at the store", "/order/pickup"], picked_up: ["Start the ride", "/order/ride"], out_for_delivery: ["Continue to customer", "/order/ride"], arrived: ["Enter delivery code", "/order/arrived"] } as const;
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : null);

function Stepper({ index }: { index: number }) {
  return (
    <View style={s.stepper}>
      {STEPS.map((label, i) => {
        const done = i <= index;
        return (
          <View key={label} style={{ flex: 1, alignItems: "center" }}>
            <View style={s.stepRow}>
              <View style={[s.line, { opacity: i === 0 ? 0 : 1, backgroundColor: done ? colors.maroon : colors.line }]} />
              <Animated.View entering={FadeInDown.delay(150 + i * 90).duration(300)} style={[s.node, done && { backgroundColor: colors.maroon, borderColor: colors.maroon }]}>{done && <Icon name="check" size={13} color={colors.white} />}</Animated.View>
              <View style={[s.line, { opacity: i === STEPS.length - 1 ? 0 : 1, backgroundColor: i < index ? colors.maroon : colors.line }]} />
            </View>
            <Text style={[s.stepLabel, done && { color: colors.maroon }]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { detail: o, error, loading, reload } = useOrderDetail(id);
  const [mediaError, setMediaError] = useState("");
  if (!o) return <OrderGate title="Order" loading={loading} error={error} onRetry={() => void reload()} />;

  const stage = stageOf(o.status);
  const next = NEXT[stage as keyof typeof NEXT];
  const cod = isCod(o);
  const promised = hhmm(o.promisedAt);
  const dial = o.customer.phone.replace(/\s/g, "");
  async function openMedia(mediaId: string) {
    setMediaError("");
    try { await Linking.openURL(await getMediaUrl(mediaId)); } catch { setMediaError("Could not open the file. Try again."); }
  }

  return (
    <Screen scroll bottomPad={36}>
      <Header title={o.orderNo} subtitle={o.warehouse.name} right={<Pill label={cod ? "COD" : "PAID"} tone={cod ? "amber" : "green"} />} />
      <Stagger i={0}><Stepper index={STEP_INDEX[stage]} /></Stagger>

      <Stagger i={1}>
        <Card style={{ marginTop: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={s.avatar}><Text style={s.avatarText}>{o.customer.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text style={type.h2}>{o.customer.name}</Text><Text style={type.small}>{o.customer.phone}</Text></View>
            <Press haptic onPress={() => void Linking.openURL(`tel:${dial}`)} style={[s.call, { backgroundColor: colors.greenSoft }]}><Icon name="phone" size={20} color={colors.green} /></Press>
            <Press haptic onPress={() => void Linking.openURL(`https://wa.me/${dial.replace(/\D/g, "")}`)} style={[s.call, { backgroundColor: colors.blueSoft }]}><Icon name="message-circle" size={20} color={colors.blue} /></Press>
          </View>
          <View style={s.rule} />
          <Row icon="map-pin" label={`${o.address.line1}, ${o.address.locality}`} />
          {o.address.landmark ? <Row icon="flag" label={o.address.landmark} /> : null}
          {o.address.deliveryNotes ? <Row icon="message-square" label={`“${o.address.deliveryNotes}”`} /> : null}
          {promised ? <Row icon="clock" label="Promised by" value={promised} /> : null}
          {o.voiceNote && (o.voiceNote.expired
            ? <Row icon="mic-off" label="Voice note expired" />
            : <VoiceNote mediaId={o.voiceNote.mediaId} seconds={o.voiceNote.durationSec} />)}
          {o.housePhoto && <Press haptic onPress={() => void openMedia(o.housePhoto!.mediaId)} style={s.media}><Icon name="image" size={16} color={colors.maroon} /><Text style={s.mediaText}>See house photo</Text></Press>}
          {mediaError ? <Text style={{ color: colors.red, fontSize: 12, fontWeight: "700", marginTop: 6 }}>{mediaError}</Text> : null}
        </Card>
      </Stagger>

      <Stagger i={2}>
        <SectionTitle action={<Text style={type.small}>{o.items.reduce((a, i) => a + i.qty, 0)} items{o.bagCount ? ` · ${o.bagCount} bags` : ""}</Text>}>Items</SectionTitle>
        <Card style={{ paddingVertical: 6 }}>
          {o.items.map((it, i) => (
            <View key={`${it.name}-${i}`} style={[s.item, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <View style={s.qty}><Text style={s.qtyText}>{it.qty}×</Text></View>
              <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "700" }]}>{it.name}</Text>{it.variantLabel ? <Text style={type.small}>{it.variantLabel}</Text> : null}</View>
            </View>
          ))}
        </Card>
      </Stagger>

      <Stagger i={3}>
        <Card style={[s.pay, { backgroundColor: cod ? colors.yellowSoft : colors.greenSoft }]}>
          <Icon name={cod ? "dollar-sign" : "check-circle"} size={22} color={cod ? colors.amber : colors.green} />
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { fontWeight: "900" }]}>{cod ? `Collect ${rupees(o.amountDue)}` : "Already paid"}</Text>
            <Text style={type.small}>{cod ? "Cash or UPI at the door" : "Do not collect any money"}</Text>
          </View>
        </Card>
      </Stagger>

      <Stagger i={4} style={{ marginTop: 22, gap: 12 }}>
        {next && <Button label={next[0]} icon="arrow-right" variant="accent" onPress={() => router.push({ pathname: next[1], params: { id: o.id } } as never)} />}
        {stage !== "delivered" && stage !== "failed" && (
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button label="Can't deliver" variant="ghost" icon="x-circle" style={{ flex: 1 }} onPress={() => router.push({ pathname: "/order/failed", params: { id: o.id } })} />
            <Button label="Problem" variant="ghost" icon="alert-circle" style={{ flex: 1 }} onPress={() => router.push({ pathname: "/problem", params: { id: o.id } })} />
          </View>
        )}
      </Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  stepper: { flexDirection: "row", marginTop: 10 },
  stepRow: { flexDirection: "row", alignItems: "center", width: "100%" },
  line: { flex: 1, height: 3, borderRadius: 2 },
  node: { width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  stepLabel: { marginTop: 7, fontSize: 11, fontWeight: "800", color: colors.faint },
  avatar: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.maroon, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.yellow, fontWeight: "900", fontSize: 18 },
  call: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  media: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.yellowSoft, borderRadius: radius.md, padding: 12, marginTop: 8 },
  mediaText: { fontWeight: "800", fontSize: 13, color: colors.maroon },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  qty: { minWidth: 40, height: 36, borderRadius: 12, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  qtyText: { fontWeight: "900", color: colors.maroon },
  pay: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
});
