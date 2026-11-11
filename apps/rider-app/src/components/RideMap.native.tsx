import { useEffect, useRef } from "react";
import MapView, { Marker, Polyline } from "react-native-maps";
import type { LatLng, RoutePath } from "../api/rider";
import { colors } from "../theme";

type Props = {
  height: number; warehouse: LatLng; destination: LatLng | null; moving?: boolean;
  /** The road to draw, from the server. */
  route?: RoutePath | null;
  /** The rider's live position and heading. */
  position?: (LatLng & { heading: number | null }) | null;
  /** True: the camera stays on the rider. False: the rider has moved the map, or has not asked to follow. */
  follow?: boolean;
  /** Called when the rider drags the map, so the screen can stop following. */
  onUserMove?: () => void;
  /** Space the bottom sheet covers, so the road is never hidden behind it. */
  bottomInset?: number;
};

/** Real map (phones): the store, the customer's door, the rider's own position and the road between. */
export function RideMap({ height, warehouse, destination, route, position, follow = false, onUserMove, bottomInset = 340 }: Props) {
  const map = useRef<MapView>(null);
  const fitted = useRef<string | null>(null);

  const points = destination ? [warehouse, destination] : [warehouse];
  const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lng = points.reduce((a, p) => a + p.lng, 0) / points.length;
  const spanLat = destination ? Math.max(0.01, Math.abs(warehouse.lat - destination.lat) * 2.4) : 0.01;
  const spanLng = destination ? Math.max(0.01, Math.abs(warehouse.lng - destination.lng) * 2.4) : 0.01;

  // Show the whole road once it first arrives (and again if the destination changes).
  useEffect(() => {
    if (!route || follow) return;
    const id = `${route.destination.lat},${route.destination.lng}`;
    if (fitted.current === id) return;
    fitted.current = id;
    map.current?.fitToCoordinates(route.points.map(p => ({ latitude: p.lat, longitude: p.lng })), {
      edgePadding: { top: 120, right: 50, bottom: bottomInset, left: 50 }, animated: true,
    });
  }, [route, follow, bottomInset]);

  // While following, keep the camera on the rider, turned the way they are heading.
  useEffect(() => {
    if (!follow || !position) return;
    map.current?.animateCamera({ center: { latitude: position.lat, longitude: position.lng }, zoom: 16.5, ...(position.heading != null && { heading: position.heading }) }, { duration: 600 });
  }, [follow, position]);

  const line = route?.points.map(p => ({ latitude: p.lat, longitude: p.lng }));

  return (
    <MapView
      ref={map} style={{ height, width: "100%" }} showsUserLocation showsMyLocationButton={false} toolbarEnabled={false}
      initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: spanLat, longitudeDelta: spanLng }}
      onPanDrag={onUserMove}
    >
      {line && <Polyline coordinates={line} strokeColor="#ffffff" strokeWidth={10} lineCap="round" lineJoin="round" />}
      {line && <Polyline coordinates={line} strokeColor={route?.approximate ? colors.amber : colors.maroon} strokeWidth={6} lineCap="round" lineJoin="round" lineDashPattern={route?.approximate ? [12, 10] : undefined} />}
      <Marker coordinate={{ latitude: warehouse.lat, longitude: warehouse.lng }} title="Store" pinColor={colors.maroon} />
      {destination && <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title="Customer" pinColor={colors.red} />}
    </MapView>
  );
}
