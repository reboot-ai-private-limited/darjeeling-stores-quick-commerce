import MapView, { Marker } from "react-native-maps";
import type { LatLng } from "../api/rider";
import { colors } from "../theme";

/** Real map (phones): the store, the customer's door and the rider's own position. */
export function RideMap({ height, warehouse, destination }: { height: number; warehouse: LatLng; destination: LatLng | null; moving?: boolean }) {
  const points = destination ? [warehouse, destination] : [warehouse];
  const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lng = points.reduce((a, p) => a + p.lng, 0) / points.length;
  const spanLat = destination ? Math.max(0.01, Math.abs(warehouse.lat - destination.lat) * 2.4) : 0.01;
  const spanLng = destination ? Math.max(0.01, Math.abs(warehouse.lng - destination.lng) * 2.4) : 0.01;
  return (
    <MapView style={{ height, width: "100%" }} showsUserLocation showsMyLocationButton={false} initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: spanLat, longitudeDelta: spanLng }}>
      <Marker coordinate={{ latitude: warehouse.lat, longitude: warehouse.lng }} title="Store" pinColor={colors.maroon} />
      {destination && <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title="Customer" pinColor={colors.red} />}
    </MapView>
  );
}
