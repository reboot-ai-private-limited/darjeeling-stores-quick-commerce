import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Constants from "expo-constants";
import * as Location from "expo-location";
import { AppState } from "react-native";
import { loadSession, setSignedOutHandler } from "../api/http";
import {
  endShift as apiEndShift, getAppConfig, getAssignments, getCash, getMe, resumeShift, sendLocation, signOutRemote, startBreak, startShift as apiStartShift, switchWarehouse,
  type ActiveOrder, type Assignment, type AssignmentEvent, type LatLng, type RiderMe, type RiderWarehouse,
} from "../api/rider";

/** Everything here comes from the API: the rider's profile and shift, the live assignments, and the cash balance. */
type Shift = { on: boolean; onBreak: boolean; startedAt: number | null; warehouse: RiderWarehouse | null };

type Ctx = {
  /** True until we know whether a saved session exists. */
  booting: boolean;
  signedIn: boolean;
  me: RiderMe | null;
  shift: Shift;
  warehouses: RiderWarehouse[];
  cashInHand: number; deliveredToday: number; pendingSync: number;
  /** Live orders (not delivered or failed yet), oldest first. */
  orders: ActiveOrder[];
  active: ActiveOrder | undefined;
  order: (id: string | undefined) => ActiveOrder | undefined;
  /** An assignment the rider has not accepted yet: the alarm rings for it. */
  ringing: Assignment | null;
  onSignedIn: () => Promise<RiderMe>;
  /** Reloads the profile, cash and live assignments. */
  refresh: () => Promise<RiderMe>;
  refreshOrders: () => Promise<void>;
  startShift: (warehouseId: string, location: LatLng, accuracyM: number | null) => Promise<{ distanceFromWarehouseM: number; verified: boolean }>;
  toggleBreak: () => Promise<void>;
  endShift: () => Promise<void>;
  signOut: () => Promise<void>;
  /** The delivery code is kept in memory only (never in the URL) between "arrived" and "delivered". */
  rememberOtp: (orderId: string, otp: string) => void;
  otpOf: (orderId: string) => string | null;
  /** Moves the rider to another store they are allowed to work from, during a shift. */
  switchStore: (warehouseId: string) => Promise<void>;
  /** Set when the server says this app version is too old or the system is under maintenance. */
  blocked: Blocked | null;
};
export type Blocked = { kind: "update" | "maintenance"; message: string; url?: string; support?: string };

const older = (v: string, min: string) => { const a = v.split(".").map(Number), b = min.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0); } return false; };

const Store = createContext<Ctx | null>(null);
const TERMINAL = new Set(["DELIVERED", "FAILED_DELIVERY", "CANCELLED"]);
const POLL_MS = 15_000;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [me, setMe] = useState<RiderMe | null>(null);
  const [cash, setCash] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [paid, setPaid] = useState<Record<string, true>>({});
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const liveCount = useRef(0);
  const cursor = useRef<string | undefined>(undefined);
  const otps = useRef<Record<string, string>>({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const applyEvents = useCallback((events: AssignmentEvent[], replace: boolean) => {
    setAssignments(prev => {
      const out: Record<string, Assignment> = replace ? {} : { ...prev };
      for (const ev of events) {
        const a = ev.assignment; if (!a?.id) continue;
        if (ev.event === "reassigned_away" || ev.event === "cancelled") delete out[a.id];
        else out[a.id] = { ...(out[a.id] ?? a), ...a };
      }
      return out;
    });
    const nowPaid = events.filter(e => e.event === "payment_paid").flatMap(e => e.assignment?.orders?.map(o => o.id) ?? []);
    if (nowPaid.length) setPaid(p => ({ ...p, ...Object.fromEntries(nowPaid.map(id => [id, true as const])) }));
  }, []);

  const loadOrders = useCallback(async (full: boolean) => {
    const { events, cursor: next } = await getAssignments(full ? undefined : cursor.current);
    if (!alive.current) return;
    if (next) cursor.current = next;
    applyEvents(events, full);
  }, [applyEvents]);

  const refresh = useCallback(async (): Promise<RiderMe> => {
    const [profile, cashSummary] = await Promise.all([getMe(), getCash().catch(() => null)]);
    if (!alive.current) return profile;
    setMe(profile); setCash(cashSummary?.cashInHand ?? 0); setDelivered(cashSummary?.deliveredToday ?? 0); setSignedIn(true);
    if (profile.currentShift) await loadOrders(true).catch(() => undefined);
    return profile;
  }, [loadOrders]);

  const refreshOrders = useCallback(async () => { await loadOrders(true); }, [loadOrders]);

  const localSignOut = useCallback(() => { setSignedIn(false); setMe(null); setCash(0); setDelivered(0); setAssignments({}); setPaid({}); cursor.current = undefined; otps.current = {}; }, []);

  // Restore a saved session when the app opens.
  useEffect(() => {
    setSignedOutHandler(localSignOut);
    (async () => {
      try {
        // Don't leave the rider on the splash screen if the server can't be reached: give up after 6 seconds and show Login.
        if (await loadSession()) await Promise.race([refresh(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))]);
      } catch { /* offline or expired: show Login */ }
      if (alive.current) setBooting(false);
    })();
    return () => setSignedOutHandler(null);
  }, [refresh, localSignOut]);

  // Ask the server on every launch whether this version is still allowed and whether maintenance is on.
  useEffect(() => {
    const version = Constants.expoConfig?.version ?? "0.1.0";
    getAppConfig(version).then(c => {
      if (c.maintenance?.active) setBlocked({ kind: "maintenance", message: c.maintenance.message ?? "We are doing some maintenance. Please try again in a little while.", ...(c.supportNumber ? { support: c.supportNumber } : {}) });
      else if (c.forceUpdate || (c.minSupportedVersion && older(version, c.minSupportedVersion))) setBlocked({ kind: "update", message: "A new version of the app is needed to keep delivering.", ...(c.downloadUrl ? { url: c.downloadUrl } : {}), ...(c.supportNumber ? { support: c.supportNumber } : {}) });
    }).catch(() => undefined);
  }, []);

  // While on shift, ask for new assignments every 15 seconds (only while the app is open on screen).
  const onShift = !!me?.currentShift;
  useEffect(() => {
    if (!signedIn || !onShift) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => { void loadOrders(false).catch(() => undefined); };
    const start = () => { if (!timer) timer = setInterval(tick, POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = undefined; } };
    start();
    const sub = AppState.addEventListener("change", s => { if (s === "active") { tick(); start(); } else stop(); });
    return () => { stop(); sub.remove(); };
  }, [signedIn, onShift, loadOrders]);

  // Share the rider's position while on shift and not on break: about every 10 s with an order, 60 s without (the server can change this).
  const onBreakNow = me?.status === "on_break";
  useEffect(() => {
    if (!signedIn || !onShift || onBreakNow) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      let wait = liveCount.current > 0 ? 10 : 60;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status === "granted" && AppState.currentState === "active") {
          const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const r = await sendLocation([{ location: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracyM: p.coords.accuracy ?? null, speedKmh: p.coords.speed != null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 3.6) : null, at: new Date(p.timestamp).toISOString() }]);
          if (r.nextPingSeconds > 0) wait = r.nextPingSeconds;
          console.log("[location ping sent]", r.accepted, "next in", wait, "s");
        }
      } catch (e) { console.warn("[location ping failed]", e instanceof Error ? e.message : e); }
      if (!stopped) timer = setTimeout(() => void run(), wait * 1000);
    };
    void run();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [signedIn, onShift, onBreakNow]);

  const value = useMemo<Ctx>(() => {
    const warehouse = me?.warehouses.find(w => w.id === (me.currentShift?.warehouseId ?? me.currentWarehouseId)) ?? null;
    const shift: Shift = { on: !!me?.currentShift, onBreak: me?.status === "on_break", startedAt: me?.currentShift ? Date.parse(me.currentShift.startedAt) : null, warehouse };
    const list = Object.values(assignments).sort((a, b) => Date.parse(a.assignedAt) - Date.parse(b.assignedAt));
    const orders: ActiveOrder[] = list.flatMap(a => a.orders
      .filter(o => !TERMINAL.has(o.status))
      .map(o => ({ ...o, assignmentId: a.id, acknowledged: a.status !== "assigned", ackDeadlineAt: a.ackDeadlineAt, alreadyPaid: !!paid[o.id] || /^(paid|prepaid|online)/i.test(o.paymentStatus) })));
    liveCount.current = orders.length;
    const ringing = list.find(a => a.status === "assigned" && a.orders.some(o => !TERMINAL.has(o.status))) ?? null;
    return {
      booting, signedIn, me, shift, warehouses: me?.warehouses ?? [],
      cashInHand: cash, deliveredToday: delivered, pendingSync: me?.pendingSyncCount ?? 0,
      orders, active: orders.find(o => o.acknowledged) ?? undefined, order: id => orders.find(o => o.id === id), ringing,
      onSignedIn: refresh, refresh, refreshOrders,
      startShift: async (warehouseId, location, accuracyM) => { const r = await apiStartShift(warehouseId, location, accuracyM); await refresh(); return r.punchIn; },
      toggleBreak: async () => { if (me?.status === "on_break") await resumeShift(); else await startBreak(); await refresh(); },
      endShift: async () => { await apiEndShift(); await refresh(); },
      signOut: async () => { await signOutRemote(); localSignOut(); },
      switchStore: async warehouseId => { await switchWarehouse(warehouseId); await refresh(); }, blocked,
      rememberOtp: (orderId, otp) => { otps.current[orderId] = otp; }, otpOf: orderId => otps.current[orderId] ?? null,
    };
  }, [booting, signedIn, me, cash, delivered, assignments, paid, blocked, refresh, refreshOrders, localSignOut]);

  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export function useStore(): Ctx {
  const v = useContext(Store);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
