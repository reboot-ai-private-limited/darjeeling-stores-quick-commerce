import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { AnimatedRegion, Marker, MarkerAnimated } from "react-native-maps";
import { colors } from "../theme";
import { Icon } from "./ui";

export type Pt = { lat: number; lng: number };

// react-native-maps types are strict about animated values and marker children, so narrow them once here.
type Glide = { setValue: (v: object) => void; timing: (v: object) => { start: () => void } };
const AnimatedMarker = MarkerAnimated as unknown as React.ComponentType<Omit<React.ComponentProps<typeof Marker>, "coordinate"> & { coordinate: unknown }>;

/** Live map: the customer's door, and the delivery partner who glides between the positions the server reports. */
export function TrackMap({ destination, rider }: { destination: Pt; rider: Pt | null }) {
  const map = useRef<MapView>(null);
  const coord = useRef(new AnimatedRegion({ latitude: rider?.lat ?? destination.lat, longitude: rider?.lng ?? destination.lng, latitudeDelta: 0, longitudeDelta: 0 }) as unknown as Glide).current;
  const seen = useRef(false);

  useEffect(() => {
    if (!rider) { seen.current = false; return; }
    if (!seen.current) {
      // first position: jump there, then frame the rider and the door together
      coord.setValue({ latitude: rider.lat, longitude: rider.lng, latitudeDelta: 0, longitudeDelta: 0 });
      seen.current = true;
      setTimeout(() => map.current?.fitToCoordinates([{ latitude: rider.lat, longitude: rider.lng }, { latitude: destination.lat, longitude: destination.lng }], { edgePadding: { top: 140, bottom: 380, left: 60, right: 60 }, animated: true }), 300);
    } else {
      coord.timing({ latitude: rider.lat, longitude: rider.lng, latitudeDelta: 0, longitudeDelta: 0, duration: 1500, useNativeDriver: false }).start();
    }
  }, [rider?.lat, rider?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MapView
      ref={map} style={StyleSheet.absoluteFill} toolbarEnabled={false}
      initialRegion={{ latitude: destination.lat, longitude: destination.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
    >
      <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} anchor={{ x: 0.5, y: 1 }}>
        <View style={s.home}><Icon name="home" size={18} color={colors.maroon} /></View>
      </Marker>
      {rider && (
        <AnimatedMarker coordinate={coord} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={s.rider}><Icon name="navigation" size={18} color={colors.maroon} /></View>
        </AnimatedMarker>
      )}
    </MapView>
  );
}

const s = StyleSheet.create({
  home: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.maroon, alignItems: "center", justifyContent: "center" },
  rider: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, borderWidth: 3, borderColor: colors.green, alignItems: "center", justifyContent: "center", elevation: 6 },
});
