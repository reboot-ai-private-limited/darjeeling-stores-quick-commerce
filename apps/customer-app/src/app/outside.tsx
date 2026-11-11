import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { joinWaitlist } from "../api/app";
import { ApiError } from "../api/http";
import { Button, Header, Icon, Screen } from "../components/ui";
import { colors, radius, space, type } from "../theme";

/** We don't deliver here (yet, or it's paused): say so kindly and offer the waitlist. */
export default function Outside() {
  const { lat, lng, label, paused } = useLocalSearchParams<{ lat?: string; lng?: string; label?: string; paused?: string }>();
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const isPaused = !!paused;
  const valid = /^[6-9]\d{9}$/.test(phone);

  const join = async () => {
    const la = Number(lat), ln = Number(lng);
    if (!valid || Number.isNaN(la) || Number.isNaN(ln)) return;
    setState("busy"); setError(null);
    try { await joinWaitlist(`+91${phone}`, { lat: la, lng: ln }); setState("done"); }
    catch (e) { setState("idle"); setError(e instanceof ApiError ? e.message : "Couldn't save your number. Please try again."); }
  };

  return (
    <Screen scroll>
      <Header back />
      <View style={{ alignItems: "center", marginTop: space.xl, gap: space.md }}>
        <View style={{ width: 132, height: 132, borderRadius: 66, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name={isPaused ? "pause-circle" : "compass"} size={60} color={colors.maroon} />
        </View>
        <Text style={[type.title, { textAlign: "center" }]}>{isPaused ? "Taking a short break" : "We're not here yet"}</Text>
        <Text style={[type.body, { textAlign: "center", color: colors.muted }]}>
          {isPaused ? "Deliveries to this area are paused for now. Leave your number and we'll tell you when we're back." : `We don't deliver${label ? ` to ${label}` : " here"} yet. Leave your number and we'll message you the day we start.`}
        </Text>
      </View>

      {state === "done" ? (
        <View style={{ alignItems: "center", gap: space.md, marginTop: space.xxl }}>
          <Icon name="check-circle" size={40} color={colors.green} />
          <Text style={type.h2}>You're on the list</Text>
          <Button label="Try another location" variant="soft" onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
        </View>
      ) : (
        <View style={{ gap: space.md, marginTop: space.xxl }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.white, borderRadius: radius.lg, paddingHorizontal: space.lg, height: 56, borderWidth: 1.5, borderColor: error ? colors.red : colors.line }}>
            <Text style={[type.body, { fontWeight: "800" }]}>+91</Text>
            <TextInput value={phone} onChangeText={t => setPhone(t.replace(/\D/g, "").slice(0, 10))} keyboardType="number-pad" placeholder="10-digit mobile number" placeholderTextColor={colors.faint} style={[type.body, { flex: 1, fontSize: 16 }]} maxLength={10} />
          </View>
          {error && <Text style={[type.small, { color: colors.red }]}>{error}</Text>}
          <Button label={state === "busy" ? "Saving…" : "Notify me"} disabled={!valid || state === "busy"} onPress={() => void join()} />
          <Button label="Try another location" variant="ghost" onPress={() => router.back()} />
        </View>
      )}
    </Screen>
  );
}
