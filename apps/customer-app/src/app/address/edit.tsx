import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { createAddress, deleteAddress, listAddresses, updateAddress, type Address } from "../../api/addresses";
import { getCities, getLocalities, type Locality } from "../../api/app";
import { getMe } from "../../api/auth";
import { ApiError } from "../../api/http";
import { uploadMessage, uploadPhoto, uploadVoice } from "../../api/media";
import { PhotoPicker, VoiceRecorder, type Picked, type Voice } from "../../components/Attach";
import { MapPicker, type Point } from "../../components/MapPicker";
import { Button, Chip, Header, Icon, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, radius, shadow, space, type } from "../../theme";

const LABELS: Address["label"][] = ["Home", "Work", "Other"];
const DARJEELING: Point = { lat: 27.041, lng: 88.2663 };
const isWeb = Platform.OS === "web";

/** Screen 19: add or edit an address. Move the map pin to the door, pick the area, and fill the house line and landmark (required). */
export default function EditAddress() {
  const { id, pick } = useLocalSearchParams<{ id?: string; pick?: string }>();
  const editing = !!id;
  const { place, setAddressId } = useStore();

  const [areas, setAreas] = useState<Locality[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState<Address["label"]>("Home");
  const [localityId, setLocalityId] = useState<string | null>(null);
  const [pin, setPin] = useState<Point>(place ?? DARJEELING);
  const [target, setTarget] = useState<Point | null>(null);
  const [line1, setLine1] = useState("");
  const [landmark, setLandmark] = useState("");
  const [pincode, setPincode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tried, setTried] = useState(false);
  const [photo, setPhoto] = useState<Picked>(null);
  const [voice, setVoice] = useState<Voice>(null);
  const [savedPhoto, setSavedPhoto] = useState<string | null>(null);
  const [savedVoice, setSavedVoice] = useState<{ mediaId: string; durationSec: number } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cities = await getCities();
        const lists = await Promise.all(cities.map(c => getLocalities(c.id)));
        const all = lists.flat();
        if (!live) return;
        setAreas(all);
        if (editing) {
          const a = (await listAddresses()).find(x => x.id === id);
          if (a && live) {
            setLabel(a.label); setLocalityId(a.localityId); setPin(a.location); setTarget(a.location); setLine1(a.line1); setLandmark(a.landmark);
            setPincode(a.pincode); setName(a.contactName); setPhone(a.contactPhone.replace(/^\+91/, "")); setNotes(a.deliveryNotes ?? ""); setMakeDefault(a.isDefault);
            setA0(a); setSavedPhoto(a.housePhoto?.mediaId ?? null); setSavedVoice(a.voiceNote ?? null);
          }
        } else {
          const me = await getMe().catch(() => null);
          if (me && live) { setName(me.name ?? ""); setPhone((me.phone ?? "").replace(/^\+91/, "")); }
        }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Couldn't load the form."); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [editing, id]);

  const [a0, setA0] = useState<Address | null>(null);
  const pickArea = (a: Locality) => { setLocalityId(a.id); setPin(a.location); setTarget(a.location); };

  const problems = {
    area: !localityId,
    line1: line1.trim().length < 2,
    landmark: landmark.trim().length < 2,
    pincode: !/^\d{6}$/.test(pincode),
    name: name.trim().length < 2,
    phone: !/^[6-9]\d{9}$/.test(phone),
  };
  const invalid = Object.values(problems).some(Boolean);

  const save = async () => {
    setTried(true);
    if (invalid || !localityId) return;
    setBusy(true); setError(null);
    // Upload the photo and voice note first; the address is saved with their ids.
    let housePhotoMediaId: string | null | undefined; let voiceMediaId: string | null | undefined;
    try {
      if (photo) housePhotoMediaId = await uploadPhoto("address_photo", photo.uri);
      else if (editing && !savedPhoto && a0?.housePhoto) housePhotoMediaId = null;
      if (voice) voiceMediaId = await uploadVoice(voice.uri, voice.seconds);
      else if (editing && !savedVoice && a0?.voiceNote) voiceMediaId = null;
    } catch (e) { setError(uploadMessage(e)); setBusy(false); return; }
    const body = {
      ...(housePhotoMediaId !== undefined ? { housePhotoMediaId } : {}), ...(voiceMediaId !== undefined ? { voiceMediaId } : {}),
      label, line1: line1.trim(), localityId, pincode, landmark: landmark.trim(), contactName: name.trim(), contactPhone: `+91${phone}`,
      location: pin, deliveryNotes: notes.trim() || null, makeDefault,
    };
    try {
      const a = editing ? await updateAddress(id!, body) : await createAddress(body);
      if (pick && a.isDeliverable) { setAddressId(a.id); router.dismissTo("/checkout"); return; }
      if (!a.isDeliverable) { setError("Saved, but we don't deliver to this spot yet. Move the pin closer to your door or pick another area."); setBusy(false); return; }
      router.back();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't save the address."); setBusy(false); }
  };

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try { await deleteAddress(id!); router.back(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete."); setBusy(false); }
  };

  const bad = (k: keyof typeof problems) => tried && problems[k];

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title={editing ? "Edit address" : "Add address"} /></View>
        {loading ? <ActivityIndicator color={colors.maroon} style={{ marginTop: 80 }} /> : (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            {!isWeb && (
              <View style={s.map}>
                <MapPicker initial={pin} target={target} onChange={setPin} />
                <View pointerEvents="none" style={s.mapHint}><Text style={s.mapHintText}>Move the map so the pin sits on your door</Text></View>
              </View>
            )}
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: space.lg, paddingBottom: 150, gap: space.md }}>
              <Text style={type.label}>Save as</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>{LABELS.map(l => <Chip key={l} label={l} active={label === l} onPress={() => setLabel(l)} />)}</View>

              <Text style={[type.label, { marginTop: space.sm }]}>Area</Text>
              {areas.length === 0 ? <Text style={type.small}>No delivery areas are open yet.</Text> : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{areas.map(a => <Chip key={a.id} label={a.name} active={localityId === a.id} onPress={() => pickArea(a)} />)}</View>
              )}
              {bad("area") && <Text style={s.err}>Choose your area.</Text>}

              <Field label="House / flat / building" value={line1} onChange={setLine1} placeholder="Cedar Villa, 2nd floor" bad={bad("line1")} maxLength={200} />
              <Field label="Landmark (required)" value={landmark} onChange={setLandmark} placeholder="Opposite Planters Club gate" bad={bad("landmark")} maxLength={200} />
              <Field label="PIN code" value={pincode} onChange={t => setPincode(t.replace(/\D/g, "").slice(0, 6))} placeholder="734101" keyboard="number-pad" bad={bad("pincode")} />
              <Field label="Contact name" value={name} onChange={setName} placeholder="Who will receive the order" bad={bad("name")} maxLength={60} />
              <Field label="Contact phone" value={phone} onChange={t => setPhone(t.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" keyboard="number-pad" prefix="+91" bad={bad("phone")} />
              <Field label="Delivery note (optional)" value={notes} onChange={setNotes} placeholder="Ring the bell twice" maxLength={300} />
              <PhotoPicker label="House photo (optional)" hint="A picture of your door or gate helps the rider find you." value={photo} onChange={setPhoto} existingId={savedPhoto} onRemoveExisting={() => setSavedPhoto(null)} />
              <VoiceRecorder value={voice} onChange={setVoice} existing={savedVoice} onRemoveExisting={() => setSavedVoice(null)} />

              <View style={s.switchRow}>
                <Text style={[type.body, { fontWeight: "700", flex: 1 }]}>Make this my default address</Text>
                <Switch value={makeDefault} onValueChange={setMakeDefault} trackColor={{ true: colors.maroon, false: colors.line }} thumbColor={colors.white} />
              </View>

              {error && <View style={s.errBox}><Icon name="alert-circle" size={16} color={colors.red} /><Text style={[type.small, { color: colors.red, flex: 1 }]}>{error}</Text></View>}
              {editing && <Button label={confirmDelete ? "Tap again to delete" : "Delete address"} variant="ghost" icon="trash-2" onPress={() => void remove()} disabled={busy} />}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </Screen>
      {!loading && (
        <View style={s.bar}><Button label={busy ? "Saving…" : "Save address"} onPress={() => void save()} disabled={busy} /></View>
      )}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboard, prefix, bad, maxLength }: { label: string; value: string; onChange: (t: string) => void; placeholder?: string; keyboard?: "number-pad"; prefix?: string; bad?: boolean; maxLength?: number }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      <View style={[s.field, bad && { borderColor: colors.red }]}>
        {prefix ? <Text style={[type.body, { fontWeight: "800" }]}>{prefix}</Text> : null}
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.faint} keyboardType={keyboard} maxLength={maxLength} style={s.input} accessibilityLabel={label} />
      </View>
      {bad && <Text style={s.err}>Please check this field.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  map: { height: 210, marginHorizontal: space.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.creamDeep },
  mapHint: { position: "absolute", top: 10, alignSelf: "center", backgroundColor: "rgba(35,24,21,0.78)", borderRadius: radius.pill, paddingHorizontal: 12, height: 28, justifyContent: "center" },
  mapHintText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  field: { flexDirection: "row", alignItems: "center", gap: space.sm, height: 54, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: space.lg },
  input: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink, outlineStyle: "none" as never },
  err: { color: colors.red, fontSize: 12, fontWeight: "700" },
  errBox: { flexDirection: "row", gap: space.sm, alignItems: "center", backgroundColor: colors.redSoft, borderRadius: radius.md, padding: space.md },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.white, borderRadius: radius.md, padding: space.lg, ...shadow.card },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: space.xl, backgroundColor: colors.cream },
});
