import { Image } from "expo-image";
import { AudioModule, createAudioPlayer, RecordingPresets, useAudioRecorder, type AudioPlayer } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { getMediaUrl } from "../api/media";
import { colors, radius, space, type } from "../theme";
import { Icon, Press } from "./ui";

export type Picked = { uri: string } | null;

/** Take or choose one photo. Shows a preview with a remove button. `existingId` is a photo already saved on the server. */
export function PhotoPicker({ label, hint, value, onChange, existingId, onRemoveExisting }: {
  label: string; hint?: string; value: Picked; onChange: (p: Picked) => void; existingId?: string | null; onRemoveExisting?: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [remote, setRemote] = useState<string | null>(null);
  useEffect(() => { setRemote(null); if (existingId) void getMediaUrl(existingId).then(setRemote).catch(() => undefined); }, [existingId]);

  const pick = async (camera: boolean) => {
    setMsg("");
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setMsg(camera ? "Allow camera access to take a photo." : "Allow photo access to choose a picture."); return; }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6, allowsEditing: false };
      const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (!r.canceled && r.assets[0]) onChange({ uri: r.assets[0].uri });
    } catch { setMsg("Couldn't open the camera or gallery."); }
  };

  const shown = value?.uri ?? (existingId ? remote : null);
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      {shown ? (
        <View style={s.previewWrap}>
          <Image source={{ uri: shown }} style={s.preview} contentFit="cover" />
          <Press haptic onPress={() => { if (value) onChange(null); else onRemoveExisting?.(); }} style={s.x}><Icon name="x" size={16} color={colors.white} /></Press>
        </View>
      ) : existingId && !value ? (
        <View style={s.attached}><Icon name="image" size={18} color={colors.maroon} /><Text style={[type.body, { flex: 1 }]}>Photo added</Text><Press onPress={() => onRemoveExisting?.()}><Icon name="trash-2" size={18} color={colors.red} /></Press></View>
      ) : (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Press haptic onPress={() => void pick(true)} style={s.btn}><Icon name="camera" size={18} color={colors.maroon} /><Text style={s.btnText}>Take photo</Text></Press>
          <Press haptic onPress={() => void pick(false)} style={s.btn}><Icon name="image" size={18} color={colors.maroon} /><Text style={s.btnText}>Choose</Text></Press>
        </View>
      )}
      {!!hint && !shown && <Text style={type.small}>{hint}</Text>}
      {!!msg && <Text style={[type.small, { color: colors.red }]}>{msg}</Text>}
    </View>
  );
}

const MAX_SEC = 10;
export type Voice = { uri: string; seconds: number } | null;

/** Record a voice note of up to 10 seconds, play it back, or remove it. `existing` is a note already saved on the server. */
export function VoiceRecorder({ value, onChange, existing, onRemoveExisting }: {
  value: Voice; onChange: (v: Voice) => void; existing?: { mediaId: string; durationSec: number } | null; onRemoveExisting?: () => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState("");
  const started = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { try { player.current?.remove(); } catch { /* already released */ } }, []);

  const stop = async () => {
    setRecording(false);
    try {
      await recorder.stop();
      const sec = Math.max(1, Math.min(MAX_SEC, Math.round((Date.now() - started.current) / 1000)));
      if (recorder.uri) onChange({ uri: recorder.uri, seconds: sec });
    } catch { setMsg("Couldn't save the recording."); }
  };
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const e = (Date.now() - started.current) / 1000; setElapsed(e);
      if (e >= MAX_SEC) void stop();
    }, 200);
    return () => clearInterval(t);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setMsg("");
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { setMsg("Allow microphone access to record a note."); return; }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record(); started.current = Date.now(); setElapsed(0); setRecording(true);
    } catch { setMsg("Couldn't start recording."); }
  };

  const play = async (source: { uri: string } | { mediaId: string }) => {
    if (playing) { player.current?.pause(); setPlaying(false); return; }
    try {
      await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = "uri" in source ? source.uri : await getMediaUrl(source.mediaId);
      try { player.current?.remove(); } catch { /* none yet */ }
      const p = createAudioPlayer({ uri }); player.current = p;
      p.addListener("playbackStatusUpdate", st => { if (st.didJustFinish) setPlaying(false); });
      p.play(); setPlaying(true);
    } catch { setMsg("Couldn't play the note."); setPlaying(false); }
  };

  if (Platform.OS === "web") return <Text style={type.small}>Voice notes can be recorded in the phone app.</Text>;

  const saved = value ?? (existing ? { uri: "", seconds: existing.durationSec } : null);
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>Voice note for the rider (optional)</Text>
      {recording ? (
        <Press haptic onPress={() => void stop()} style={[s.attached, { backgroundColor: colors.redSoft }]}>
          <Icon name="square" size={18} color={colors.red} /><Text style={[type.body, { flex: 1, color: colors.red, fontWeight: "800" }]}>Recording… {Math.floor(elapsed)}s / {MAX_SEC}s · tap to stop</Text>
        </Press>
      ) : saved ? (
        <View style={s.attached}>
          <Press haptic onPress={() => void play(value ?? { mediaId: existing!.mediaId })}><Icon name={playing ? "pause" : "play"} size={18} color={colors.maroon} /></Press>
          <Text style={[type.body, { flex: 1 }]}>Voice note · {saved.seconds}s</Text>
          <Press onPress={() => { if (value) onChange(null); else onRemoveExisting?.(); }}><Icon name="trash-2" size={18} color={colors.red} /></Press>
        </View>
      ) : (
        <Press haptic onPress={() => void start()} style={s.btn}><Icon name="mic" size={18} color={colors.maroon} /><Text style={s.btnText}>Record (up to {MAX_SEC}s)</Text></Press>
      )}
      {!saved && !recording && <Text style={type.small}>Tell the rider how to find your door.</Text>}
      {!!msg && <Text style={[type.small, { color: colors.red }]}>{msg}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line },
  btnText: { fontSize: 14, fontWeight: "800", color: colors.maroon },
  attached: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.yellowSoft, borderRadius: radius.md, padding: space.md },
  previewWrap: { width: 120, height: 120, borderRadius: radius.md, overflow: "hidden" },
  preview: { width: "100%", height: "100%" },
  x: { position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
});
