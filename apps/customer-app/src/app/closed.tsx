import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { getStoreStatus, type StoreStatus } from "../api/cart";
import { opensText } from "../api/preorder";
import { Button, Header, Icon, Screen } from "../components/ui";
import { useCart } from "../state/cart";
import { useStore } from "../state/store";
import { colors, space, type } from "../theme";

/** Screen 40: the store is closed or paused. Shows when it opens and, where offered, lets the customer pre-order. */
export default function Closed() {
  const { zone } = useStore();
  const { count } = useCart();
  const [st, setSt] = useState<StoreStatus | null>(null);
  const [err, setErr] = useState(false);
  const load = () => { setErr(false); if (zone) void getStoreStatus(zone.id).then(setSt).catch(() => setErr(true)); };
  useEffect(load, [zone]); // eslint-disable-line react-hooks/exhaustive-deps
  const opens = opensText(st?.opensAt);

  return (
    <Screen>
      <Header title="Store status" />
      <View style={s.center}>
        {!st && !err && <ActivityIndicator color={colors.maroon} />}
        {err && <><Text style={type.small}>Couldn't check the store. Check your connection.</Text><Button label="Try again" variant="soft" onPress={load} /></>}
        {st?.accepting && (
          <>
            <View style={[s.icon, { backgroundColor: colors.greenSoft }]}><Icon name="check" size={36} color={colors.green} /></View>
            <Text style={type.title}>We're open!</Text>
            <Button label="Start shopping" onPress={() => router.replace("/home")} style={s.btn} />
          </>
        )}
        {st && !st.accepting && (
          <>
            <View style={[s.icon, { backgroundColor: colors.amberSoft }]}><Icon name={st.paused ? "pause" : "moon"} size={36} color={colors.amber} /></View>
            <Text style={type.title}>{st.paused ? "Taking a short break" : "We're closed right now"}</Text>
            <Text style={[type.small, { textAlign: "center" }]}>{st.pauseMessage ?? (opens ? `We open ${opens}.` : "We'll be back soon.")}</Text>
            {opens && st.paused && <Text style={[type.body, { fontWeight: "800" }]}>Back {opens}</Text>}
            {st.preOrderAvailable ? (
              <>
                <Text style={[type.small, { textAlign: "center" }]}>You can still pre-order and pick a delivery time.</Text>
                <Button label={count > 0 ? "Pre-order my cart" : "Browse and pre-order"} icon="calendar" onPress={() => router.replace(count > 0 ? "/cart" : "/home")} style={s.btn} />
              </>
            ) : <Text style={[type.small, { textAlign: "center" }]}>Pre-orders aren't available right now. You can still browse.</Text>}
            <Button label="Keep browsing" variant="soft" onPress={() => router.replace("/home")} style={s.btn} />
          </>
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  icon: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  btn: { alignSelf: "stretch" },
});
