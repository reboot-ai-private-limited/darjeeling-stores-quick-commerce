import type { LatLng } from "../api/rider";
import { MapCanvas } from "./MapCanvas";

/** Browser preview: the drawn map (real map tiles are only used on the phone). */
export function RideMap({ height, moving = false }: { height: number; warehouse?: LatLng; destination?: LatLng | null; moving?: boolean }) {
  return <MapCanvas height={height} moving={moving} />;
}
