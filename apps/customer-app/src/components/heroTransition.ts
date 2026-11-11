/** Where a tapped product card was on screen, so the product page can grow out of it and shrink back into it. */
export type Origin = { id: string; uri: string | null; x: number; y: number; w: number; h: number };
let origin: Origin | null = null;
export const setOrigin = (o: Origin | null) => { origin = o; };
/** The remembered card position, only if it belongs to this product. */
export const takeOrigin = (id: string): Origin | null => (origin && origin.id === id ? origin : null);
