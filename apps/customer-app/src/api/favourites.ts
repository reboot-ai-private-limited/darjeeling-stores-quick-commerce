import { useCallback, useEffect, useState } from "react";
import type { Product } from "./catalog";
import { kv } from "./kv";

const KEY = "customer.favourites";
const read = async (): Promise<Product[]> => { try { return JSON.parse((await kv.get(KEY)) ?? "[]") as Product[]; } catch { return []; } };

/** Favourites live on the phone for now (the backend has no wishlist). */
export function useFavourites() {
  const [list, setList] = useState<Product[]>([]);
  useEffect(() => { void read().then(setList); }, []);
  const has = useCallback((id: string) => list.some(p => p.id === id), [list]);
  const toggle = useCallback(async (p: Product) => {
    const cur = await read();
    const next = cur.some(x => x.id === p.id) ? cur.filter(x => x.id !== p.id) : [p, ...cur].slice(0, 100);
    setList(next); await kv.set(KEY, JSON.stringify(next));
  }, []);
  const reload = useCallback(() => { void read().then(setList); }, []);
  return { list, has, toggle, reload };
}
