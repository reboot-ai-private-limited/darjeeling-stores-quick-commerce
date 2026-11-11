import { Linking, Text, View } from "react-native";
import { Button, Icon, Screen } from "../components/ui";
import { useStore } from "../state/store";
import { colors, space, type } from "../theme";

/** Shown when the app is too old (update required) or the system is under maintenance. */
export default function Blocked() {
  const { blocked } = useStore();
  const update = blocked?.kind === "update";
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md }}>
        <Icon name={update ? "download-cloud" : "tool"} size={56} color={colors.maroon} />
        <Text style={[type.title, { textAlign: "center" }]}>{update ? "Update required" : "Back in a moment"}</Text>
        <Text style={[type.body, { textAlign: "center", color: colors.muted }]}>{blocked?.message}</Text>
      </View>
      {update && blocked?.url && <Button label="Update now" onPress={() => void Linking.openURL(blocked.url!)} />}
      {blocked?.support && <Button label="Call support" variant="ghost" style={{ marginTop: space.sm }} onPress={() => void Linking.openURL(`tel:${blocked.support}`)} />}
    </Screen>
  );
}
