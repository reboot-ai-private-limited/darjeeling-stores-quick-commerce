import type { LatLng, RoutePath } from "../api/rider";
import { MapCanvas } from "./MapCanvas";

/** Browser preview: the drawn map (real map tiles are only used on the phone). */
export function RideMap({ height, moving = false }: { height: number; warehouse?: LatLng; destination?: LatLng | null; moving?: boolean; route?: RoutePath | null; position?: (LatLng & { heading: number | null }) | null; follow?: boolean; onUserMove?: () => void; bottomInset?: number }) {
  return <MapCanvas height={height} moving={moving} />;
}
