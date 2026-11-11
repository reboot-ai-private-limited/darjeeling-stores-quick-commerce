import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { requestPhoneChange, verifyPhoneChange } from "../api/account";
import { getMe, toE164, updateMe } from "../api/auth";
import { Button, Card, Header, Screen } from "../components/ui";
import { colors, radius, space, type } from "../theme";

/** Screen 34: change name and email, or change the phone number with a code. */
export default function EditProfile() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [newPhone, setNewPhone] = useState(""); const [otp, setOtp] = useState(""); const [sent, setSent] = useState(false); const [pmsg, setPmsg] = useState("");
  useEffect(() => { void getMe().then(m => { setName(m.name ?? ""); setEmail(m.email ?? ""); setPhone(m.phone); }).catch(() => undefined); }, []);
  const emailOk = email === "" || /^\S+@\S+\.\S+$/.test(email);

  const save = async () => {
    setBusy(true); setMsg("");
    try { await updateMe({ name: name.trim(), ...(email ? { email: email.trim() } : {}) }); setMsg("Saved."); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  };
  const sendCode = async () => {
    setBusy(true); setPmsg("");
    try { await requestPhoneChange(toE164(newPhone)); setSent(true); setPmsg("We sent a code to the new number."); }
    catch (e) { setPmsg(e instanceof Error ? e.message : "Couldn't send the code."); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setPmsg("");
    try { await verifyPhoneChange(toE164(newPhone), otp); setPhone(toE164(newPhone)); setSent(false); setNewPhone(""); setOtp(""); setPmsg("Phone number updated."); }
    catch (e) { setPmsg(e instanceof Error ? e.message : "That code didn't work."); } finally { setBusy(false); }
  };

  return (
    <Screen scroll>
      <Header title="Edit profile" />
      <Card style={{ gap: space.sm }}>
        <Text style={type.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Your name" style={s.input} />
        <Text style={[type.label, { marginTop: space.sm }]}>Email (optional)</Text>
        <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" style={s.input} />
        {!emailOk && <Text style={[type.small, { color: colors.red }]}>Enter a valid email.</Text>}
        {!!msg && <Text style={type.small}>{msg}</Text>}
        <Button label={busy ? "Saving…" : "Save"} disabled={busy || name.trim().length < 2 || !emailOk} onPress={() => void save()} style={{ marginTop: space.sm }} />
      </Card>
      <Card style={{ gap: space.sm, marginTop: space.md }}>
        <Text style={type.h2}>Phone number</Text>
        <Text style={type.small}>Current: {phone}</Text>
        <TextInput value={newPhone} onChangeText={t => setNewPhone(t.replace(/\D/g, "").slice(0, 10))} placeholder="New 10-digit number" keyboardType="number-pad" style={s.input} editable={!sent} />
        {sent && <TextInput value={otp} onChangeText={t => setOtp(t.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" keyboardType="number-pad" style={s.input} />}
        {!!pmsg && <Text style={type.small}>{pmsg}</Text>}
        {sent
          ? <Button label="Confirm number" disabled={busy || otp.length !== 6} onPress={() => void confirm()} />
          : <Button label="Send code" variant="soft" disabled={busy || newPhone.length !== 10} onPress={() => void sendCode()} />}
        <Text style={type.small}>Changing your number signs you out of other devices.</Text>
      </Card>
      <View style={{ height: space.xl }} />
    </Screen>
  );
}

const s = StyleSheet.create({ input: { backgroundColor: colors.cream, borderRadius: radius.md, paddingHorizontal: space.md, height: 50, fontSize: 16, color: colors.ink } });
