import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { API_ORIGIN } from "../../api/config";
import { getMediaUrl, uploadProfilePhoto } from "../../api/rider";
import { SwipeButton } from "../../components/SwipeButton";
import { Card, Icon, Pill, Press, Screen, Stagger, type IconName } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, radius, rupees, type } from "../../theme";

function Item({ icon, label, hint, onPress, tone }: { icon: IconName; label: string; hint?: string; onPress: () => void; tone?: string }) {
  return (
    <Press onPress={onPress} haptic style={s.item}>
      <View style={s.itemIcon}><Icon name={icon} size={19} color={tone ?? colors.maroon} /></View>
      <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: "800", color: tone ?? colors.ink }]}>{label}</Text>{hint && <Text style={type.small}>{hint}</Text>}</View>
      <Icon name="chevron-right" size={18} color={colors.faint} />
    </Press>
  );
}

/** "+919800000010" -> "+91 98000 00010" */
const prettyPhone = (p: string) => p.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");

export default function Profile() {
  const { me, shift, deliveredToday, cashInHand, pendingSync, orders, endShift, signOut, refresh } = useStore();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoId = me?.photo?.mediaId;
  useEffect(() => { setPhotoUrl(null); if (photoId) void getMediaUrl(photoId).then(setPhotoUrl, () => undefined); }, [photoId]);
  async function changePhoto() {
    if (!me || photoBusy) return;
    setError("");
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
      const asset = picked.canceled ? null : picked.assets[0];
      if (!asset) return;
      setPhotoBusy(true);
      await uploadProfilePhoto(me.riderId, asset.uri, asset.mimeType ?? "image/jpeg");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not change your photo."); }
    finally { setPhotoBusy(false); }
  }
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const busy = orders.length > 0 || (me?.activeOrderCount ?? 0) > 0;
  const name = me?.name ?? "Rider";
  const initials = name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Screen scroll bottomPad={120}>
      <Stagger i={0} style={{ alignItems: "center", marginTop: 24 }}>
        <Press onPress={() => void changePhoto()} haptic scaleTo={0.97}>
          <View style={s.avatar}>
            {photoUrl ? <Image source={{ uri: photoUrl }} style={s.avatarImg} /> : <Text style={s.avatarText}>{initials}</Text>}
            <View style={[s.live, shift.onBreak && { backgroundColor: colors.amber }]} />
            <View style={s.camera}><Icon name={photoBusy ? "loader" : "camera"} size={14} color={colors.maroon} /></View>
          </View>
        </Press>
        <Text style={[type.title, { marginTop: 14 }]}>{name}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>{me ? prettyPhone(me.phone) : ""}</Text>
        <View style={{ marginTop: 10 }}>
          <Pill label={shift.onBreak ? `On break · ${shift.warehouse?.name ?? ""}` : `On shift · ${shift.warehouse?.name ?? ""}`} tone={shift.onBreak ? "amber" : "green"} icon={shift.onBreak ? "coffee" : "radio"} />
        </View>
      </Stagger>

      <Stagger i={1} style={{ flexDirection: "row", gap: 10, marginTop: 22 }}>
        {[["Delivered today", String(deliveredToday)], ["Cash in hand", rupees(cashInHand)], ["Stores", String(me?.warehouses.length ?? 0)]].map(([k, v]) => (
          <Card key={k} style={{ flex: 1, alignItems: "center", padding: 14 }}>
            <Text style={{ fontSize: 20, fontWeight: "900", color: colors.ink }} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
            <Text style={[type.small, { textAlign: "center" }]}>{k}</Text>
          </Card>
        ))}
      </Stagger>

      <Stagger i={2} style={{ marginTop: 22 }}>
        <Card style={{ padding: 6 }}>
          <Item icon="gift" label="Tips" hint="What you have earned and what is owed" onPress={() => router.push("/tips")} />
          <Item icon="clock" label="Delivery history" hint="Everything you've delivered" onPress={() => router.push("/history")} />
          <Item icon="refresh-cw" label="Sync status" hint={pendingSync ? `${pendingSync} waiting to upload` : "All caught up"} onPress={() => router.push("/sync")} />
          <Item icon="alert-circle" label="Report a problem" hint="Tell the store right away" onPress={() => router.push("/problem")} tone={colors.red} />
        </Card>
      </Stagger>

      <Stagger i={3} style={{ marginTop: 26, gap: 14 }}>
        <SwipeButton
          label={busy ? "Finish your orders first" : "Slide to end shift"} icon="log-out" tone="red" disabled={busy} resetKey={resetKey}
          onConfirm={async () => { setError(""); try { await endShift(); router.replace("/start-shift"); } catch (e) { setError(e instanceof Error ? e.message : "Could not end your shift."); setResetKey(k => k + 1); } }}
        />
        {error ? <Text style={{ color: colors.red, fontWeight: "700", fontSize: 13, textAlign: "center" }}>{error}</Text> : null}
        <Press onPress={async () => { await signOut(); router.replace("/login"); }} haptic style={s.signOut}>
          <Icon name="log-out" size={16} color={colors.muted} /><Text style={{ color: colors.muted, fontWeight: "800" }}>Sign out</Text>
        </Press>
      </Stagger>

      <Text style={s.foot}>Darjeeling Rider v{Constants.expoConfig?.version ?? "0.1.0"} · {API_ORIGIN.replace(/^https?:\/\//, "")}</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  avatar: { width: 96, height: 96, borderRadius: 34, backgroundColor: colors.maroon, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 96, height: 96, borderRadius: 34 },
  camera: { position: "absolute", left: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.cream, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.yellow, fontSize: 34, fontWeight: "900" },
  live: { position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.green, borderWidth: 4, borderColor: colors.cream },
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.md },
  itemIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  signOut: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", padding: 12 },
  foot: { textAlign: "center", color: colors.faint, fontSize: 11, fontWeight: "600", marginTop: 18 },
});
