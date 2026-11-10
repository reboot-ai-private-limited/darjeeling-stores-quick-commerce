import { Linking, Text, View } from "react-native";
import { Button, Icon, Screen } from "../components/ui";
import { useStore } from "../state/store";
import { colors, type } from "../theme";

/** Shown instead of the app when the server asks for an update or is in maintenance. */
export default function Blocked() {
  const { blocked } = useStore();
  const update = blocked?.kind === "update";
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 10 }}>
        <View style={{ width: 96, height: 96, borderRadius: 32, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name={update ? "download" : "tool"} size={44} color={colors.maroon} />
        </View>
        <Text style={type.title}>{update ? "Update needed" : "Back soon"}</Text>
        <Text style={[type.small, { textAlign: "center" }]}>{blocked?.message ?? "Please try again in a little while."}</Text>
        {update && blocked?.url ? <View style={{ alignSelf: "stretch", marginTop: 10 }}><Button label="Get the update" icon="download" onPress={() => void Linking.openURL(blocked.url!)} /></View> : null}
        {blocked?.support ? <Button label={`Call support ${blocked.support}`} icon="phone" variant="ghost" onPress={() => void Linking.openURL(`tel:${blocked.support}`)} /> : null}
      </View>
    </Screen>
  );
}
