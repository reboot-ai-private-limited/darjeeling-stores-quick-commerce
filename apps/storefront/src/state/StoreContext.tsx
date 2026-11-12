"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getMe,
  getStoreStatus,
  resolveLocation,
  signOutRemote,
  syncCartRemote,
} from "../lib/api";
import { cookies, storage } from "../lib/storage";
import type { Line, Place, Product, StoreStatus, User, Variant, Zone } from "../lib/types";

const PLACE_KEY = "darjeeling.place";
const CART_KEY = "darjeeling.cart";
const ZONE_COOKIE = "darjeeling_zone_id";
const FAVS_KEY = "darjeeling.favs";

interface StoreContextType {
  booting: boolean;
  user: User | null;
  signedIn: boolean;
  zone: Zone | null;
  place: Place | null;
  storeStatus: StoreStatus | null;
  setPlace: (p: Place) => Promise<{ deliverable: boolean; paused: boolean }>;
  signOut: () => Promise<void>;
  setUser: (u: User | null) => void;

  // Cart
  lines: Line[];
  count: number;
  subtotal: number;
  savings: number;
  qtyOf: (variantId: string) => number;
  add: (p: Product, v: Variant) => void;
  inc: (variantId: string) => void;
  remove: (variantId: string) => void;
  removeLine: (variantId: string) => void;
  clearCart: () => void;
  applyServerCart: (
    items: { variantId: string; unitPrice: number; maxQty: number; available: boolean }[],
    corrections: { variantId: string; qty: number }[]
  ) => void;
  couponCode: string | null;
  setCouponCode: (c: string | null) => void;

  // Favourites
  favourites: Set<string>;
  favouriteProducts: Product[];
  toggleFavourite: (product: Product) => void;
  isFavourite: (productId: string) => boolean;

  // Modal / Drawer controls
  isCartDrawerOpen: boolean;
  setIsCartDrawerOpen: (open: boolean) => void;
  isLocationModalOpen: boolean;
  setIsLocationModalOpen: (open: boolean) => void;
  isLoginModalOpen: boolean;
  setIsLoginModalOpen: (open: boolean) => void;
}

const StoreContext = createContext<StoreContextType | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [place, setPlaceState] = useState<Place | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [favouriteProducts, setFavouriteProducts] = useState<Product[]>([]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());

  // UI Drawer / Modal states
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Initial client boot
  useEffect(() => {
    let mounted = true;

    async function init() {
      // 1. Restore Place & Zone
      const savedPlace = storage.getJSON<{ place: Place; zone: Zone } | null>(PLACE_KEY, null);
      if (savedPlace) {
        setPlaceState(savedPlace.place);
        setZone(savedPlace.zone);
        cookies.set(ZONE_COOKIE, savedPlace.zone.id);
        void getStoreStatus(savedPlace.zone.id)
          .then((st) => mounted && setStoreStatus(st))
          .catch(() => undefined);
      }

      // 2. Restore local cart
      const savedLines = storage.getJSON<Line[]>(CART_KEY, []);
      setLines(savedLines);

      // 3. Restore Favourites from storage (client-side only, backend has no wishlist)
      const savedFavs = storage.getJSON<Product[]>(FAVS_KEY, []);
      setFavouriteProducts(savedFavs);
      setFavourites(new Set(savedFavs.map((p) => p.id)));

      // 4. Check active auth session (ensure it is a customer session, not a staff/admin session from another port)
      try {
        const me = await getMe();
        if (mounted) {
          if (me && me.kind === "customer") {
            setUser(me);
          } else {
            setUser(null);
          }
        }
      } catch {
        /* guest */
        if (mounted) setUser(null);
      } finally {
        if (mounted) setBooting(false);
      }
    }

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist cart changes
  useEffect(() => {
    if (!booting) {
      storage.setJSON(CART_KEY, lines);
    }
  }, [lines, booting]);

  // Set Place & resolve Zone
  const setPlace = useCallback(async (p: Place) => {
    try {
      const point = p.localityId ? { localityId: p.localityId } : { lat: p.lat, lng: p.lng };
      const res = await resolveLocation(point);
      if (res.deliverable && res.zone) {
        setPlaceState(p);
        setZone(res.zone);
        cookies.set(ZONE_COOKIE, res.zone.id);
        storage.setJSON(PLACE_KEY, { place: p, zone: res.zone });

        void getStoreStatus(res.zone.id)
          .then((st) => setStoreStatus(st))
          .catch(() => undefined);

        return { deliverable: true, paused: !!res.paused };
      }
      return { deliverable: false, paused: false };
    } catch {
      return { deliverable: false, paused: false };
    }
  }, []);

  const signOut = useCallback(async () => {
    await signOutRemote();
    setUser(null);
  }, []);

  // Cart operations (exact parity with customer-app/src/state/cart.tsx)
  const add = useCallback((p: Product, v: Variant) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === v.variantId);
      if (idx >= 0) {
        const item = prev[idx]!;
        if (item.qty >= item.maxQty) return prev;
        return prev.map((x, k) => (k === idx ? { ...x, qty: x.qty + 1 } : x));
      }
      const img = p.images?.[0]?.url ?? null;
      return [
        ...prev,
        {
          variantId: v.variantId,
          productId: p.id,
          name: p.name,
          label: v.label,
          price: v.price,
          mrp: v.mrp,
          imageUrl: img,
          qty: 1,
          maxQty: v.maxQty,
          available: v.available,
        },
      ];
    });
  }, []);

  const inc = useCallback((variantId: string) => {
    setLines((prev) =>
      prev.map((l) => (l.variantId === variantId && l.qty < l.maxQty ? { ...l, qty: l.qty + 1 } : l))
    );
  }, []);

  const remove = useCallback((variantId: string) => {
    setLines((prev) =>
      prev.flatMap((l) => (l.variantId !== variantId ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []))
    );
  }, []);

  const removeLine = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }, []);

  /** Takes the server's prices, stock limits and removed items into the local cart, like the app does after a cart upload. */
  const applyServerCart = useCallback<StoreContextType["applyServerCart"]>((items, corrections) => {
    setLines((prev) => {
      let changed = false;
      const next = prev.flatMap((l) => {
        const s = items.find((x) => x.variantId === l.variantId);
        const c = corrections.find((x) => x.variantId === l.variantId);
        let line = l;
        if (s && (s.unitPrice !== l.price || s.maxQty !== l.maxQty || s.available !== (l.available ?? true))) {
          line = { ...line, price: s.unitPrice, maxQty: s.maxQty, available: s.available };
          changed = true;
        }
        if (c && c.qty !== line.qty) {
          changed = true;
          if (c.qty <= 0) return [];
          line = { ...line, qty: c.qty };
        }
        return [line];
      });
      return changed ? next : prev;
    });
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
    setCouponCode(null);
  }, []);

  const qtyOf = useCallback(
    (variantId: string) => lines.find((l) => l.variantId === variantId)?.qty ?? 0,
    [lines]
  );

  const count = useMemo(() => lines.reduce((n, l) => n + l.qty, 0), [lines]);
  const subtotal = useMemo(() => lines.reduce((n, l) => n + l.qty * l.price, 0), [lines]);
  const savings = useMemo(
    () => lines.reduce((n, l) => n + l.qty * Math.max(0, l.mrp - l.price), 0),
    [lines]
  );

  // Favourites operations (local storage only, matching customer mobile app)
  const toggleFavourite = useCallback((product: Product) => {
    setFavouriteProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      const next = exists ? prev.filter((p) => p.id !== product.id) : [product, ...prev];
      storage.setJSON(FAVS_KEY, next);
      setFavourites(new Set(next.map((p) => p.id)));
      return next;
    });
  }, []);

  const isFavourite = useCallback((id: string) => favourites.has(id), [favourites]);

  const value = useMemo<StoreContextType>(
    () => ({
      booting,
      user,
      signedIn: !!user && user.kind === "customer",
      zone,
      place,
      storeStatus,
      setPlace,
      signOut,
      setUser,
      lines,
      count,
      subtotal,
      savings,
      qtyOf,
      add,
      inc,
      remove,
      removeLine,
      clearCart,
      applyServerCart,
      couponCode,
      setCouponCode,
      favourites,
      favouriteProducts,
      toggleFavourite,
      isFavourite,
      isCartDrawerOpen,
      setIsCartDrawerOpen,
      isLocationModalOpen,
      setIsLocationModalOpen,
      isLoginModalOpen,
      setIsLoginModalOpen,
    }),
    [
      booting,
      user,
      zone,
      place,
      storeStatus,
      setPlace,
      signOut,
      lines,
      count,
      subtotal,
      savings,
      qtyOf,
      add,
      inc,
      remove,
      removeLine,
      clearCart,
      applyServerCart,
      couponCode,
      favourites,
      favouriteProducts,
      toggleFavourite,
      isFavourite,
      isCartDrawerOpen,
      isLocationModalOpen,
      isLoginModalOpen,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = (): StoreContextType => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
};
