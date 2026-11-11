export type Point = { lat: number; lng: number };

/** Browser preview has no map: the location screen falls back to the area list. */
export function MapPicker(_props: { initial: Point; target?: Point | null; onChange: (p: Point) => void }) {
  return null;
}
