import { StyleSheet, Text, View } from "react-native";
import { colors, type } from "../theme";
import { Icon } from "./ui";

export type Pt = { lat: number; lng: number };

/** Browser preview: no map tiles, so show a plain panel (the status, ETA and timeline below still work). */
export function TrackMap({ rider }: { destination: Pt; rider: Pt | null }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.creamDeep, alignItems: "center", justifyContent: "center", gap: 8 }]}>
      <Icon name="map" size={40} color={colors.faint} />
      <Text style={type.small}>{rider ? "Your delivery partner is on the way" : "The live map shows on your phone"}</Text>
    </View>
  );
}
