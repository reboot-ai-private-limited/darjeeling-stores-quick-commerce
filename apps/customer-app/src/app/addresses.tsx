import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addressLine, deleteAddress, listAddresses, setDefaultAddress, type Address } from "../api/addresses";
import { Button, Header, Icon, Pill, Press, Screen, tap, type IconName } from "../components/ui";
import { useStore } from "../state/store";
import { colors, radius, shadow, space, type } from "../theme";

const ICON: Record<Address["label"], IconName> = { Home: "home", Work: "briefcase", Other: "map-pin" };

/** Screen 18: saved addresses. With `?pick=1` (from the cart) tapping one chooses it for this order; otherwise tapping edits it. */
export default function Addresses() {
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const insets = useSafeAreaInsets();
  const picking = !!pick;
  const { signedIn, addressId, setAddressId } = useStore();
  const [items, setItems] = useState<Address[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!signedIn) return;
    setError(null);
    try {
      const list = await listAddresses();
      setItems(list);
      // Keep the chosen address valid: fall back to the default if it was deleted.
      if (addressId && !list.some(a => a.id === addressId)) setAddressId(list.find(a => a.isDefault)?.id ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load your addresses."); }
  }, [signedIn, addressId, setAddressId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const choose = (a: Address) => {
    tap();
    if (!picking) { router.push({ pathname: "/address/edit", params: { id: a.id } }); return; }
    if (!a.isDeliverable) return;
    setAddressId(a.id);
    router.replace("/checkout");
  };
  const makeDefault = async (a: Address) => { try { await setDefaultAddress(a.id); await load(); } catch { /* shown on next load */ } };

  // First tap arms the trash button ("Delete?"), the second deletes.
  const remove = async (a: Address) => {
    if (confirmId !== a.id) { setConfirmId(a.id); return; }
    setConfirmId(null);
    try { await deleteAddress(a.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete the address."); }
  };

  const selected = addressId ?? items?.find(a => a.isDefault)?.id;

  return (
    <View style={{ flex: 1 }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title={picking ? "Deliver to" : "My addresses"} /></View>
        {!signedIn ? (
          <View style={s.center}><Text style={[type.body, { color: colors.muted, textAlign: "center" }]}>Sign in to save and use delivery addresses.</Text><Button label="Sign in" onPress={() => router.push("/login")} /></View>
        ) : error ? (
          <View style={s.center}><Icon name="wifi-off" size={36} color={colors.faint} /><Text style={type.small}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} /></View>
        ) : !items ? (
          <ActivityIndicator color={colors.maroon} style={{ marginTop: 80 }} />
        ) : items.length === 0 ? (
          <View style={s.center}>
            <View style={s.emptyIcon}><Icon name="map-pin" size={40} color={colors.maroon} /></View>
            <Text style={type.title}>No addresses yet</Text>
            <Text style={[type.small, { textAlign: "center" }]}>Add where we should deliver your orders.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 130 + insets.bottom, gap: space.md }}>
            {items.map(a => {
              const on = picking && selected === a.id;
              return (
                <Press key={a.id} onPress={() => choose(a)} style={{ opacity: picking && !a.isDeliverable ? 0.6 : 1 }}>
                  <View style={[s.card, on && { borderColor: colors.maroon }]}>
                    <View style={s.icon}><Icon name={ICON[a.label] ?? "map-pin"} size={20} color={colors.maroon} /></View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                        <Text style={type.h2}>{a.label}</Text>
                        {a.isDefault && <Pill label="DEFAULT" tone="maroon" />}
                        {!a.isDeliverable && <Pill label="NOT DELIVERABLE" tone="red" />}
                      </View>
                      <Text style={type.body}>{addressLine(a)}</Text>
                      <Text style={type.small}>{a.contactName} · {a.contactPhone}</Text>
                      {!a.isDeliverable && <Text style={[type.small, { color: colors.red }]}>We don't deliver to this spot yet.</Text>}
                      {!picking && !a.isDefault && <Press onPress={() => void makeDefault(a)} haptic style={{ alignSelf: "flex-start", marginTop: 4 }}><Text style={s.link}>Make default</Text></Press>}
                    </View>
                    <View style={{ alignItems: "center", gap: space.sm }}>
                      {picking && <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.dot} />}</View>}
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Press onPress={() => router.push({ pathname: "/address/edit", params: { id: a.id } })} haptic style={{ padding: 6 }}><Icon name="edit-2" size={18} color={colors.muted} /></Press>
                        <Press onPress={() => void remove(a)} haptic style={{ padding: 6 }}>
                          {confirmId === a.id ? <Text style={[s.link, { color: colors.red }]}>Delete?</Text> : <Icon name="trash-2" size={18} color={colors.red} />}
                        </Press>
                      </View>
                    </View>
                  </View>
                </Press>
              );
            })}
          </ScrollView>
        )}
      </Screen>
      {signedIn && !error && items && (
        <View style={[s.bar, { paddingBottom: insets.bottom + space.md }]}>
          <Button label="Add new address" icon="plus" onPress={() => router.push({ pathname: "/address/edit", params: picking ? { pick: "1" } : {} })} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "flex-start", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, borderWidth: 2, borderColor: "transparent", ...shadow.card },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  link: { fontSize: 13, fontWeight: "800", color: colors.maroon },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginTop: 2 },
  radioOn: { borderColor: colors.maroon },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.maroon },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.cream },
});
