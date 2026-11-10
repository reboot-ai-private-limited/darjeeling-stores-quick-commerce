import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { failDelivery, uploadFailedDeliveryPhoto, type FailReason } from "../../api/rider";
import { OrderGate } from "../../components/OrderGate";
import { Button, Card, Header, Icon, Press, Screen, SectionTitle, Stagger } from "../../components/ui";
import { FAIL_REASONS } from "../../reasons";
import { useStore } from "../../state/store";
import { useOrderDetail } from "../../state/useOrderDetail";
import { colors, radius, type } from "../../theme";

export default function Failed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refresh } = useStore();
  const { detail: o, error, loading, reload } = useOrderDetail(id);
  const [reason, setReason] = useState<FailReason | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; type: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [sent, setSent] = useState(false);
  if (!o) return <OrderGate title="Couldn't deliver" loading={loading} error={error} onRetry={() => void reload()} />;

  async function takePhoto() {
    setFailure("");
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setFailure("Camera permission is off. Allow it in your phone settings to take a photo."); return; }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      const asset = shot.canceled ? null : shot.assets[0];
      if (asset) setPhoto({ uri: asset.uri, type: asset.mimeType ?? "image/jpeg" });
    } catch { setFailure("The camera could not be opened on this device."); }
  }

  async function submit() {
    if (!o || !reason) return;
    setBusy(true); setFailure("");
    try {
      const mediaId = photo ? await uploadFailedDeliveryPhoto(o.id, photo.uri, photo.type) : null;
      await failDelivery(o.id, reason, note.trim() || null, mediaId);
      setSent(true);
      await refresh().catch(() => undefined);
      setTimeout(() => router.replace("/(tabs)"), 1300);
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not send the report."); }
    finally { setBusy(false); }
  }

  if (sent) return (
    <Screen><View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
      <Animated.View entering={ZoomIn.duration(220)} style={s.sentIcon}><Icon name="check" size={44} color={colors.maroon} /></Animated.View>
      <Animated.Text entering={FadeIn.delay(200)} style={type.title}>Reported</Animated.Text>
      <Animated.Text entering={FadeIn.delay(300)} style={[type.small, { textAlign: "center", paddingHorizontal: 40 }]}>The store has been told. Bring the order back to {o.warehouse.name}.</Animated.Text>
    </View></Screen>
  );

  return (
    <Screen scroll bottomPad={36}>
      <Header title="Couldn't deliver" subtitle={`${o.orderNo} · ${o.customer.name}`} />
      <Stagger i={0}><SectionTitle>What happened?</SectionTitle></Stagger>
      <View style={{ gap: 10 }}>
        {FAIL_REASONS.map((r, i) => (
          <Stagger key={r.value} i={i + 1}>
            <Press haptic onPress={() => setReason(r.value)} style={[s.reason, reason === r.value && { borderColor: colors.maroon, backgroundColor: colors.white }]}>
              <View style={[s.radio, reason === r.value && { borderColor: colors.maroon }]}>{reason === r.value && <Animated.View entering={ZoomIn.duration(180)} style={s.dot} />}</View>
              <Text style={[type.body, { flex: 1, fontWeight: "700" }]}>{r.label}</Text>
            </Press>
          </Stagger>
        ))}
      </View>
      <Stagger i={8}>
        <SectionTitle>Photo (recommended)</SectionTitle>
        <Press haptic onPress={() => void takePhoto()} style={[s.photo, photo && { backgroundColor: colors.greenSoft, borderColor: colors.green }]}>
          <Icon name={photo ? "check-circle" : "camera"} size={26} color={photo ? colors.green : colors.maroon} />
          <Text style={[type.body, { fontWeight: "800", color: photo ? colors.green : colors.maroon }]}>{photo ? "Photo added · tap to retake" : "Take a photo of the door"}</Text>
        </Press>
        <Card style={{ marginTop: 12, padding: 4 }}><TextInput value={note} onChangeText={setNote} maxLength={500} placeholder="Add a note (optional)" placeholderTextColor={colors.faint} multiline style={s.note} /></Card>
      </Stagger>
      {failure ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 14 }}>{failure}</Text> : null}
      <Stagger i={9} style={{ marginTop: 24 }}><Button label={busy ? "Sending…" : "Report failed delivery"} variant="danger" icon="send" disabled={!reason || busy} onPress={() => void submit()} /></Stagger>
    </Screen>
  );
}

const s = StyleSheet.create({
  reason: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.lg, backgroundColor: colors.creamDeep, borderWidth: 2, borderColor: "transparent" },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.faint, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.maroon },
  photo: { flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "center", height: 76, borderRadius: radius.lg, borderWidth: 2, borderStyle: "dashed", borderColor: colors.maroon, backgroundColor: colors.yellowSoft },
  note: { minHeight: 80, padding: 14, fontSize: 15, color: colors.ink, textAlignVertical: "top", outlineStyle: "none" as never },
  sentIcon: { width: 96, height: 96, borderRadius: 32, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
});
