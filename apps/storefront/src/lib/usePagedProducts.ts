"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Product } from "./types";

type Page = { items: Product[]; nextCursor: string | null };

/**
 * Infinite scroll for a product list that loads page by page (10 at a time).
 * `load(cursor)` fetches one page; the list starts again whenever `deps` change (a new category, filter or zone).
 * Put `sentinelRef` on an element below the grid: when it comes near the screen, the next page loads.
 */
export function usePagedProducts(load: (cursor: string | null) => Promise<Page>, enabled: boolean, deps: readonly unknown[]) {
  const [items, setItems] = useState<Product[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0); // bumped to start the list again after a failed first page
  const generation = useRef(0); // a response that arrives after the list was reset is ignored
  const busy = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    const mine = ++generation.current;
    busy.current = true;
    setLoading(true); setFailed(false); setItems([]); setCursor(null); setHasMore(false);
    loadRef.current(null)
      .then((page) => { if (generation.current !== mine) return; setItems(page.items); setCursor(page.nextCursor); setHasMore(page.nextCursor !== null); })
      .catch(() => { if (generation.current === mine) setFailed(true); })
      .finally(() => { if (generation.current === mine) { busy.current = false; setLoading(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);

  const loadMore = useCallback(() => {
    if (busy.current || !hasMore || cursor === null) return;
    const mine = generation.current;
    busy.current = true;
    setLoadingMore(true);
    loadRef.current(cursor)
      .then((page) => {
        if (generation.current !== mine) return;
        // A product that moved between pages is shown once.
        setItems((prev) => { const seen = new Set(prev.map((p) => p.id)); return [...prev, ...page.items.filter((p) => !seen.has(p.id))]; });
        setCursor(page.nextCursor); setHasMore(page.nextCursor !== null);
      })
      .catch(() => { if (generation.current === mine) setFailed(true); })
      .finally(() => { if (generation.current === mine) { busy.current = false; setLoadingMore(false); } });
  }, [cursor, hasMore]);

  // Watch a marker below the grid. The observer is rebuilt after every page, so a page that does not fill the screen asks for the next one.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const sentinelRef = useCallback((el: HTMLElement | null) => setNode(el), []);
  useEffect(() => {
    if (!node || !hasMore || loading || failed) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "400px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, hasMore, loading, failed, loadMore, items.length]);

  const retry = useCallback(() => { setFailed(false); if (cursor === null) setTick((t) => t + 1); else loadMore(); }, [cursor, loadMore]);
  return { items, loading, loadingMore, hasMore, failed, retry, sentinelRef };
}
