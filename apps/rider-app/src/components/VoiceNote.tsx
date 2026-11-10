import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { getMediaUrl } from "../api/rider";
import { colors, radius } from "../theme";
import { Icon, Press } from "./ui";

/** Plays the customer's voice note inside the app. The link to the file is fetched only when the rider taps play. */
export function VoiceNote({ mediaId, seconds }: { mediaId: string; seconds: number }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { try { player.current?.remove(); } catch { /* already released */ } }, []);

  async function toggle() {
    if (state === "playing") { player.current?.pause(); setState("idle"); return; }
    setState("loading");
    try {
      const url = await getMediaUrl(mediaId);
      try { player.current?.remove(); } catch { /* none yet */ }
      const p = createAudioPlayer({ uri: url });
      player.current = p;
      p.addListener("playbackStatusUpdate", st => { if (st.didJustFinish) setState("idle"); });
      p.play();
      setState("playing");
    } catch { setState("error"); }
  }

  return (
    <Press haptic onPress={() => void toggle()} style={s.row}>
      <Icon name={state === "playing" ? "pause" : "play"} size={16} color={colors.maroon} />
      <Text style={s.text}>{state === "loading" ? "Loading…" : state === "playing" ? "Playing… tap to stop" : state === "error" ? "Could not play. Tap to retry" : `Play voice note (${seconds}s)`}</Text>
    </Press>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.yellowSoft, borderRadius: radius.md, padding: 12, marginTop: 8 },
  text: { fontWeight: "800", fontSize: 13, color: colors.maroon },
});
