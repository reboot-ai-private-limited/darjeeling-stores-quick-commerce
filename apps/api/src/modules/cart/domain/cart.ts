/** Cart and quote rules as pure functions. Money is paise. */

export interface CartItem { productId: string; variantId: string; qty: number }
export interface ZoneChange {
  fromZoneId: string; toZoneId: string;
  removed: { productId: string; variantId: string; name: string; reason: "not_sold_in_zone" }[];
  repriced: { productId: string; variantId: string; oldUnitPrice: number; newUnitPrice: number }[];
}
export interface Cart {
  userId: string; zoneId: string | null; addressId: string | null; couponCode: string | null; clientRev: number; items: CartItem[];
  /** A zone change the customer has not yet confirmed; a quote needs `acceptZoneChange` while it is set. */
  zoneChange: ZoneChange | null; updatedAt: Date; reminderSentAt: Date | null;
}

export type Correction = { productId: string; variantId: string; reason: "out_of_stock" | "max_qty" | "not_sold_in_zone" | "price_changed"; qty: number };

/** Repeated lines for the same variant become one line. */
export function mergeItems(items: readonly CartItem[]): CartItem[] {
  const merged = new Map<string, CartItem>();
  for (const item of items) {
    const key = `${item.productId}|${item.variantId}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, qty: existing.qty + item.qty } : { ...item });
  }
  return [...merged.values()];
}

export interface AllocWarehouse { id: string; travelMinutes: number }
export interface AllocLine { available: ReadonlyMap<string, number>; qty: number }
export type Allocation = { ok: true; groups: { warehouseId: string; lines: number[] }[] } | { ok: false; uncovered: number[] };

const covers = (line: AllocLine, warehouseId: string) => (line.available.get(warehouseId) ?? 0) >= line.qty;

/**
 * Which warehouse supplies which lines. One warehouse with everything wins (the nearest). Otherwise the warehouse covering
 * the most remaining lines goes first (nearest on a tie) until all are covered. A line is never split between warehouses.
 * More groups than `maxSplits` fails, naming the lines that cannot be supplied together.
 */
export function allocate(lines: readonly AllocLine[], warehouses: readonly AllocWarehouse[], maxSplits: number): Allocation {
  const order = [...warehouses].sort((a, b) => a.travelMinutes - b.travelMinutes || (a.id < b.id ? -1 : 1));
  const all = lines.map((_, i) => i);
  const whole = order.find(w => lines.every(l => covers(l, w.id)));
  if (whole) return { ok: true, groups: [{ warehouseId: whole.id, lines: all }] };

  const groups: { warehouseId: string; lines: number[] }[] = [];
  let remaining = all;
  while (remaining.length > 0) {
    let best: { warehouseId: string; lines: number[] } | null = null;
    for (const w of order) {
      const got = remaining.filter(i => covers(lines[i]!, w.id));
      if (got.length > (best?.lines.length ?? 0)) best = { warehouseId: w.id, lines: got };
    }
    if (!best) return { ok: false, uncovered: remaining };
    groups.push(best);
    remaining = remaining.filter(i => !best!.lines.includes(i));
  }
  if (groups.length > maxSplits) return { ok: false, uncovered: groups.slice(maxSplits).flatMap(g => g.lines) };
  return { ok: true, groups };
}

/** Pro-rata shares of an amount by weights; the rounding remainder goes to the first. The shares add up to the amount. */
export function shares(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (total === 0) return weights.map((_, i) => (i === 0 ? amount : 0));
  const parts = weights.map(w => Math.floor((amount * w) / total));
  parts[0] = parts[0]! + (amount - parts.reduce((a, b) => a + b, 0));
  return parts;
}
