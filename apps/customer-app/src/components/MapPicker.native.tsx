import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { type Region } from "react-native-maps";
import { Icon } from "./ui";
import { colors } from "../theme";

export type Point = { lat: number; lng: number };

/** A map with a fixed pin in the middle: the customer drags the map under the pin. `target` re-centres the map. */
export function MapPicker({ initial, target, onChange }: { initial: Point; target?: Point | null; onChange: (p: Point) => void }) {
  const ref = useRef<MapView>(null);
  useEffect(() => {
    if (target) ref.current?.animateToRegion({ latitude: target.lat, longitude: target.lng, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 500);
  }, [target]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={ref} style={StyleSheet.absoluteFill} showsUserLocation showsMyLocationButton={false}
        initialRegion={{ latitude: initial.lat, longitude: initial.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
        onRegionChangeComplete={(r: Region) => onChange({ lat: r.latitude, lng: r.longitude })}
      />
      <View pointerEvents="none" style={s.pinWrap}>
        <View style={s.head}><Icon name="home" size={22} color={colors.maroon} /></View>
        <View style={s.stem} />
        <View style={s.dot} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Positioned so the tip of the stem sits exactly at the centre of the map.
  pinWrap: { position: "absolute", top: "50%", left: "50%", marginLeft: -24, marginTop: -66, width: 48, alignItems: "center" },
  head: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.maroon, alignItems: "center", justifyContent: "center", elevation: 6 },
  stem: { width: 4, height: 16, backgroundColor: colors.maroon, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  dot: { width: 10, height: 5, borderRadius: 5, backgroundColor: "rgba(0,0,0,0.3)", marginTop: -1 },
});
