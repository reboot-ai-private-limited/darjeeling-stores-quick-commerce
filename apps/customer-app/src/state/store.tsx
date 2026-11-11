import Constants from "expo-constants";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAppConfig, resolveLocation, type Zone } from "../api/app";
import { loadSession, setSignedOutHandler } from "../api/http";
import { signOutRemote } from "../api/auth";
import { kv } from "../api/kv";

export type Blocked = { kind: "update" | "maintenance"; message: string; url?: string; support?: string };
export type Place = { label: string; lat: number; lng: number };

type Ctx = {
  /** True until the saved session, saved place and server config have been checked. */
  booting: boolean;
  signedIn: boolean;
  blocked: Blocked | null;
  /** The delivery place the customer chose, and the zone it resolved to. Catalogue calls need a zone. */
  place: Place | null;
  zone: Zone | null;
  /** Resolves a point to a zone and remembers it. Returns whether we deliver there. */
  setPlace: (p: Place) => Promise<{ deliverable: boolean; paused: boolean }>;
  welcomed: boolean;
  markWelcomed: () => void;
  onSignedIn: () => void;
  signOut: () => Promise<void>;
  /** The address chosen for this order (kept across restarts). */
  addressId: string | null;
  setAddressId: (id: string | null) => void;
};

const Store = createContext<Ctx | null>(null);
const PLACE_KEY = "customer.place";
const WELCOME_KEY = "customer.welcomed";
const ADDRESS_KEY = "customer.address";
const older = (v: string, min: string) => { const a = v.split(".").map(Number), b = min.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0); } return false; };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [place, setPlaceState] = useState<Place | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const [welcomed, setWelcomed] = useState(false);
  const [addressId, setAddressIdState] = useState<string | null>(null);

  useEffect(() => {
    setSignedOutHandler(() => setSignedIn(false));
    let live = true;
    (async () => {
      setSignedIn(await loadSession());
      const [rawPlace, seen, addr] = await Promise.all([kv.get(PLACE_KEY), kv.get(WELCOME_KEY), kv.get(ADDRESS_KEY)]);
      if (seen) setWelcomed(true);
      if (addr) setAddressIdState(addr);
      if (rawPlace) {
        try {
          const saved = JSON.parse(rawPlace) as { place: Place; zone: Zone };
          if (live) { setPlaceState(saved.place); setZone(saved.zone); }
        } catch { /* ignore a corrupt saved place */ }
      }
      try {
        const version = Constants.expoConfig?.version ?? "0.0.0";
        const cfg = await getAppConfig(version);
        if (cfg.maintenance?.active) setBlocked({ kind: "maintenance", message: cfg.maintenance.message ?? "We're making things better. Back shortly.", support: cfg.supportNumber });
        else if (cfg.forceUpdate || (cfg.minSupportedVersion && older(version, cfg.minSupportedVersion))) setBlocked({ kind: "update", message: "Please update the app to keep ordering.", url: cfg.downloadUrl, support: cfg.supportNumber });
      } catch { /* offline at launch: carry on, individual calls explain network trouble */ }
      if (live) setBooting(false);
    })();
    return () => { live = false; setSignedOutHandler(null); };
  }, []);

  const setPlace = useCallback(async (p: Place) => {
    const r = await resolveLocation({ lat: p.lat, lng: p.lng });
    if (r.deliverable && r.zone) {
      setPlaceState(p); setZone(r.zone);
      await kv.set(PLACE_KEY, JSON.stringify({ place: p, zone: r.zone }));
    }
    return { deliverable: r.deliverable, paused: !!r.paused };
  }, []);

  const markWelcomed = useCallback(() => { setWelcomed(true); void kv.set(WELCOME_KEY, "1"); }, []);
  const onSignedIn = useCallback(() => setSignedIn(true), []);
  const signOut = useCallback(async () => { await signOutRemote(); setSignedIn(false); setAddressIdState(null); void kv.del(ADDRESS_KEY); }, []);
  const setAddressId = useCallback((id: string | null) => { setAddressIdState(id); if (id) void kv.set(ADDRESS_KEY, id); else void kv.del(ADDRESS_KEY); }, []);

  const value = useMemo(() => ({ booting, signedIn, blocked, place, zone, setPlace, welcomed, markWelcomed, onSignedIn, signOut, addressId, setAddressId }), [booting, signedIn, blocked, place, zone, setPlace, welcomed, markWelcomed, onSignedIn, signOut, addressId, setAddressId]);
  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(Store);
  if (!c) throw new Error("useStore must be used inside StoreProvider");
  return c;
}
