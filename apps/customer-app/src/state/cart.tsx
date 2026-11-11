import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cardImage, type Product, type Variant } from "../api/catalog";
import { kv } from "../api/kv";

export type Line = { variantId: string; productId: string; name: string; label: string; price: number; mrp: number; imageUrl: string | null; qty: number; maxQty: number; available?: boolean };
/** What the server says about the lines we sent it (see PUT /cart). */
export type ServerLine = { variantId: string; unitPrice: number; maxQty: number; available: boolean };
export type Correction = { productId: string; variantId: string; reason: string; qty: number };

type Ctx = {
  lines: Line[];
  count: number;
  /** Items total in paise (before fees and discounts, which the server works out at checkout). */
  subtotal: number;
  /** What the customer saves against the MRP, in paise. */
  savings: number;
  qtyOf: (variantId: string) => number;
  add: (p: Product, v: Variant) => void;
  /** One more of a line already in the cart (used by the cart screen). */
  inc: (variantId: string) => void;
  /** One fewer; removes the line at zero. */
  remove: (variantId: string) => void;
  /** Takes the whole line out. */
  removeLine: (variantId: string) => void;
  clear: () => void;
  /** Replaces the local lines with the server's cart (used after Reorder). The server cart has no MRP, so it falls back to the price. */
  setFromServer: (items: { productId: string; variantId: string; qty: number; name: string; variantLabel: string; unitPrice: number; maxQty: number; available: boolean; imageUrl?: string | null }[]) => void;
  /** Applies the server's prices, limits and corrections to the local lines. */
  applyServer: (items: ServerLine[], corrections: Correction[]) => void;
};

const Cart = createContext<Ctx | null>(null);
const KEY = "customer.cart";

/**
 * The phone's copy of the cart, kept for speed and across restarts.
 * The server cart is the truth: the cart screen syncs it and applies the server's prices and corrections.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<Line[]>([]);
  const ready = useRef(false);

  useEffect(() => {
    void kv.get(KEY).then(raw => { try { if (raw) setLines(JSON.parse(raw) as Line[]); } catch { /* ignore corrupt cart */ } ready.current = true; });
  }, []);
  useEffect(() => { if (ready.current) void kv.set(KEY, JSON.stringify(lines)); }, [lines]);

  const add = useCallback((p: Product, v: Variant) => {
    setLines(prev => {
      const i = prev.findIndex(l => l.variantId === v.variantId);
      if (i >= 0) { const l = prev[i]!; if (l.qty >= l.maxQty) return prev; return prev.map((x, k) => (k === i ? { ...x, qty: x.qty + 1 } : x)); }
      return [...prev, { variantId: v.variantId, productId: p.id, name: p.name, label: v.label, price: v.price, mrp: v.mrp, imageUrl: cardImage(p), qty: 1, maxQty: v.maxQty }];
    });
  }, []);
  const inc = useCallback((variantId: string) => {
    setLines(prev => prev.map(l => (l.variantId === variantId && l.qty < l.maxQty ? { ...l, qty: l.qty + 1 } : l)));
  }, []);
  const remove = useCallback((variantId: string) => {
    setLines(prev => prev.flatMap(l => (l.variantId !== variantId ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : [])));
  }, []);
  const removeLine = useCallback((variantId: string) => setLines(prev => prev.filter(l => l.variantId !== variantId)), []);
  const clear = useCallback(() => setLines([]), []);
  const setFromServer = useCallback<Ctx["setFromServer"]>(items => {
    setLines(prev => items.filter(i => i.qty > 0).map(i => {
      const old = prev.find(l => l.variantId === i.variantId);
      return { variantId: i.variantId, productId: i.productId, name: i.name, label: i.variantLabel, price: i.unitPrice, mrp: Math.max(old?.mrp ?? 0, i.unitPrice), imageUrl: i.imageUrl ?? old?.imageUrl ?? null, qty: i.qty, maxQty: i.maxQty, available: i.available };
    }));
  }, []);

  const applyServer = useCallback((items: ServerLine[], corrections: Correction[]) => {
    setLines(prev => {
      let changed = false;
      const next = prev.flatMap(l => {
        const s = items.find(x => x.variantId === l.variantId);
        const c = corrections.find(x => x.variantId === l.variantId);
        let line = l;
        if (s && (s.unitPrice !== l.price || s.maxQty !== l.maxQty || s.available !== (l.available ?? true))) { line = { ...line, price: s.unitPrice, maxQty: s.maxQty, available: s.available }; changed = true; }
        if (c && c.qty !== line.qty) { changed = true; if (c.qty <= 0) return []; line = { ...line, qty: c.qty }; }
        return [line];
      });
      return changed ? next : prev;
    });
  }, []);

  const value = useMemo<Ctx>(() => ({
    lines,
    count: lines.reduce((n, l) => n + l.qty, 0),
    subtotal: lines.reduce((n, l) => n + l.qty * l.price, 0),
    savings: lines.reduce((n, l) => n + l.qty * Math.max(0, l.mrp - l.price), 0),
    qtyOf: id => lines.find(l => l.variantId === id)?.qty ?? 0,
    add, inc, remove, removeLine, clear, applyServer, setFromServer,
  }), [lines, add, inc, remove, removeLine, clear, applyServer, setFromServer]);
  return <Cart.Provider value={value}>{children}</Cart.Provider>;
}

export function useCart(): Ctx {
  const c = useContext(Cart);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}
