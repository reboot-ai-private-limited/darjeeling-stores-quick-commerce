import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { LEGAL_URLS } from "../../api/config";
import { getMe, type Me } from "../../api/auth";
import { Button, Card, Icon, Press, Row, Screen, type IconName } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, space, type } from "../../theme";

const LINKS: [IconName, string, string][] = [
  ["user", "Edit profile", "/edit-profile"],
  ["home", "My addresses", "/addresses"],
  ["rotate-ccw", "My refunds", "/refunds"],
  ["bell", "Back-in-stock alerts", "/notify-me"],
  ["sliders", "Notification settings", "/notification-prefs"],
];

/** Screen 33: who is signed in, shortcuts to the account screens, the delivery place, and sign in / sign out. */
export default function Account() {
  const { signedIn, signOut, place } = useStore();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { if (signedIn) void getMe().then(setMe).catch(() => setMe(null)); else setMe(null); }, [signedIn]);

  return (
    // The floating tab bar and cart bar sit over the bottom of the page, so leave room below the last button (same as the other tabs).
    <Screen scroll bottomPad={190}>
      <Text style={[type.title, { marginTop: space.lg }]}>Account</Text>
      <Card style={{ marginTop: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}><Icon name="user" size={26} color={colors.maroon} /></View>
        <View style={{ flex: 1 }}>
          <Text style={type.h2}>{signedIn ? (me?.name || "Welcome") : "Guest"}</Text>
          <Text style={type.small}>{signedIn ? me?.phone ?? "" : "Sign in to order and track deliveries"}</Text>
        </View>
      </Card>
      <Card style={{ marginTop: space.md }}>
        <Row icon="map-pin" label="Delivery location" value={place?.label ?? "Not set"} />
      </Card>
      <Card style={{ marginTop: space.md, padding: 0, overflow: "hidden" }}>
        <Press onPress={() => router.push("/favourites")} style={s.link}>
          <Icon name="heart" size={19} color={colors.maroon} /><Text style={[type.body, { flex: 1, fontWeight: "600" }]}>Favourites</Text><Icon name="chevron-right" size={18} color={colors.faint} />
        </Press>
      </Card>
      {signedIn && (
        <Card style={{ marginTop: space.md, padding: 0, overflow: "hidden" }}>
          {LINKS.map(([icon, label, path], i) => (
            <Press key={path} onPress={() => router.push(path as never)} style={[s.link, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <Icon name={icon} size={19} color={colors.maroon} />
              <Text style={[type.body, { flex: 1, fontWeight: "600" }]}>{label}</Text>
              <Icon name="chevron-right" size={18} color={colors.faint} />
            </Press>
          ))}
        </Card>
      )}
      <Card style={{ marginTop: space.md, padding: 0, overflow: "hidden" }}>
        <Press onPress={() => void Linking.openURL(LEGAL_URLS.privacy)} style={s.link}>
          <Icon name="shield" size={19} color={colors.maroon} /><Text style={[type.body, { flex: 1, fontWeight: "600" }]}>Privacy policy</Text><Icon name="external-link" size={17} color={colors.faint} />
        </Press>
        <Press onPress={() => void Linking.openURL(LEGAL_URLS.terms)} style={[s.link, { borderTopWidth: 1, borderTopColor: colors.line }]}>
          <Icon name="file-text" size={19} color={colors.maroon} /><Text style={[type.body, { flex: 1, fontWeight: "600" }]}>Terms &amp; conditions</Text><Icon name="external-link" size={17} color={colors.faint} />
        </Press>
        {signedIn && (
          <Press onPress={() => router.push("/delete-account")} style={[s.link, { borderTopWidth: 1, borderTopColor: colors.line }]}>
            <Icon name="trash-2" size={19} color={colors.red} /><Text style={[type.body, { flex: 1, fontWeight: "600", color: colors.red }]}>Delete account</Text><Icon name="chevron-right" size={18} color={colors.faint} />
          </Press>
        )}
      </Card>
      <View style={{ marginTop: space.xl, gap: space.sm }}>
        <Button label="Change location" variant="soft" icon="map-pin" onPress={() => router.push("/location")} />
        <Button label="Help & support" variant="soft" icon="help-circle" onPress={() => router.push("/help")} />
        {signedIn ? <Button label="Sign out" variant="ghost" icon="log-out" onPress={() => void signOut()} /> : <Button label="Sign in" icon="log-in" onPress={() => router.push("/login")} />}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({ link: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg } });
