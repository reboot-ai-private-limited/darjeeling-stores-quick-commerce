"use client";

import React, { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { ApiError, apiFetch, getOrderGroup } from "../../../lib/api";
import { ago, isActiveStatus, pollMs, STEPS, stepTimes, trackingHeadline, type Tracking } from "../../../lib/tracking";
import type { OrderGroup } from "../../../lib/types";
import { Icon } from "../../../components/ui/Icon";

export const dynamic = "force-dynamic";

type Point = { lat: number; lng: number };

const pin = (bg: string, fg: string, glyph: string, size: number) =>
  `<div style="background:${bg};color:${fg};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size / 2)}px;border:2px solid #ffffff;box-shadow:0 4px 10px rgba(0,0,0,0.3);">${glyph}</div>`;

export default function TrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: childOrderId } = use(params);
  const searchParams = useSearchParams();
  const groupId = searchParams.get("group");

  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [group, setGroup] = useState<OrderGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const riderMarker = useRef<Marker | null>(null);
  const statusRef = useRef("PLACED");

  // Poll the server: often while the rider is out, rarely before. Keep the last answer if a poll fails.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const t = await apiFetch<Tracking>("GET", `/orders/${encodeURIComponent(childOrderId)}/tracking`);
        if (!active) return;
        setTracking(t);
        setStale(false);
        setNotFound(false);
        statusRef.current = t.status;
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setStale(true);
      } finally {
        if (active) {
          setLoading(false);
          if (isActiveStatus(statusRef.current)) timer = setTimeout(() => void poll(), pollMs(statusRef.current));
        }
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [childOrderId]);

  // The order group has the delivery code and address.
  useEffect(() => {
    if (!groupId) return;
    getOrderGroup(groupId)
      .then(setGroup)
      .catch(() => undefined);
  }, [groupId]);

  // The order itself carries the delivery address and its map position, so the map does not depend on the ?group= link.
  const [orderAddr, setOrderAddr] = useState<{ line1?: string; landmark?: string; locality?: string; pincode?: string; location?: Point | null } | null>(null);
  const [orderAddrDone, setOrderAddrDone] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch<{ groupId?: string; address?: { line1?: string; landmark?: string; locality?: string; pincode?: string; location?: Point | null } }>("GET", `/orders/${encodeURIComponent(childOrderId)}`)
      .then(async (o) => {
        if (!live) return;
        setOrderAddr(o.address ?? null);
        // The order points at its group, which has the address and its map position, so the page works without ?group= in the link.
        if (!groupId && o.groupId) {
          try {
            const g = await getOrderGroup(o.groupId);
            if (live) setGroup(g);
          } catch {
            /* no address: the map placeholder explains it */
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setOrderAddrDone(true);
      });
    return () => {
      live = false;
    };
  }, [childOrderId, groupId]);

  // "Updated N min ago" keeps counting between polls.
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(i);
  }, []);

  const door: Point | null = (group?.address as { location?: Point } | undefined)?.location ?? orderAddr?.location ?? null;
  const riderPos: Point | null = tracking?.rider?.location ?? null;

  // The box that holds the map only exists once the tracking answer is in, and the delivery position may arrive before or after it,
  // so the map has to start whenever the box appears, not only when the position changes.
  const showMap = !!tracking && !!door;

  // Map: delivery address pin, plus the rider pin that moves as new positions arrive.
  useEffect(() => {
    if (!showMap || !mapEl.current || !door) return;
    let mounted = true;
    import("leaflet").then((L) => {
      if (!mounted || !mapEl.current) return;
      // A map left over from a box that has since been replaced cannot be reused.
      if (mapRef.current && mapRef.current.getContainer() !== mapEl.current) {
        mapRef.current.remove();
        mapRef.current = null;
        riderMarker.current = null;
      }
      if (!mapRef.current) {
        const map = L.map(mapEl.current).setView([door.lat, door.lng], 15);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap", maxZoom: 19 }).addTo(map);
        L.marker([door.lat, door.lng], { icon: L.divIcon({ className: "door-pin", html: pin("#1f9d62", "#fff", "🏠", 32), iconSize: [32, 32], iconAnchor: [16, 16] }) })
          .addTo(map)
          .bindPopup("Your delivery address");
        mapRef.current = map;
        // The box may still be settling into its final size; without this the map can draw grey or half empty.
        setTimeout(() => map.invalidateSize(), 250);
      }
      const map = mapRef.current;
      if (riderPos) {
        const ll: [number, number] = [riderPos.lat, riderPos.lng];
        if (riderMarker.current) riderMarker.current.setLatLng(ll);
        else
          riderMarker.current = L.marker(ll, { icon: L.divIcon({ className: "rider-pin", html: pin("#ffc933", "#401815", "🛵", 36), iconSize: [36, 36], iconAnchor: [18, 18] }) })
            .addTo(map)
            .bindPopup(tracking?.rider?.name ?? "Delivery partner");
        map.fitBounds(L.latLngBounds([[door.lat, door.lng], ll]), { padding: [40, 40], maxZoom: 16 });
      } else if (riderMarker.current) {
        riderMarker.current.remove();
        riderMarker.current = null;
      }
    });
    return () => {
      mounted = false;
    };
  }, [showMap, door?.lat, door?.lng, riderPos?.lat, riderPos?.lng, tracking?.rider?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tear the map down when the page closes.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      riderMarker.current = null;
    },
    []
  );

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Track my Darjeeling Stores order", url });
      } catch {
        /* share sheet closed */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  const status = tracking?.status ?? "";
  const head = status ? trackingHeadline(status) : null;
  const active = status ? isActiveStatus(status) : true;
  const otp = tracking?.deliveryOtp ?? group?.deliveryOtp ?? null;
  const times = stepTimes(tracking?.timeline);
  let reached = -1;
  times.forEach((t, i) => {
    if (t) reached = i;
  });
  const etaMin =
    tracking?.eta.liveEtaMinutes ??
    (tracking?.eta.promisedAt ? Math.max(0, Math.round((new Date(tracking.eta.promisedAt).getTime() - now) / 60000)) : null);
  const addr = group?.address ?? orderAddr;
  const orderNo = tracking?.orderNo ?? childOrderId.slice(-6);

  return (
    <main className="page-container" style={{ padding: "16px 16px 60px", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href={groupId ? `/orders/${groupId}` : "/account/orders"} style={{ color: "var(--maroon)", display: "flex" }} aria-label="Back">
            <Icon name="arrow-left" size={20} />
          </Link>
          <div>
            <h1 className="title" style={{ fontSize: 20 }}>Track order</h1>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Order #{orderNo}</span>
          </div>
        </div>
        <button onClick={() => void share()} className="btn-icon" title="Share tracking link" aria-label="Share tracking link">
          <Icon name={copied ? "check" : "share-2"} size={18} color="var(--maroon)" />
        </button>
      </div>

      {loading && <div className="skeleton" style={{ height: 160, borderRadius: 22 }} />}

      {!loading && notFound && !tracking && (
        <div style={{ textAlign: "center", padding: "60px 16px" }}>
          <Icon name="package" size={40} color="var(--faint)" />
          <h2 className="title" style={{ marginTop: 10 }}>We could not find this order</h2>
          <p className="small" style={{ marginTop: 6 }}>It may belong to another account.</p>
          <Link href="/account/orders" className="btn btn-primary" style={{ marginTop: 16 }}>
            My orders
          </Link>
        </div>
      )}

      {!loading && !tracking && !notFound && (
        <div style={{ textAlign: "center", padding: "60px 16px" }}>
          <Icon name="wifi-off" size={40} color="var(--faint)" />
          <p className="small" style={{ margin: "10px 0 16px" }}>Couldn&apos;t load tracking right now.</p>
          <button className="btn btn-soft" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      )}

      {tracking && head && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Status + ETA */}
          <div style={{ background: "var(--maroon)", color: "#fff", borderRadius: 22, padding: "18px 20px", boxShadow: "var(--shadow-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800, color: "var(--yellow)", textTransform: "uppercase", letterSpacing: 0.8 }}>
              {active && <span className="live-dot" style={{ background: "var(--yellow)" }} />}
              {active ? "Live" : "Final status"}
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, marginTop: 6 }}>{head.title}</div>
            {head.sub && <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>{head.sub}</div>}
            {active && etaMin !== null && (
              <div style={{ display: "inline-block", marginTop: 12, background: "var(--yellow)", color: "var(--maroon)", fontWeight: 900, fontSize: 13, padding: "6px 14px", borderRadius: 9999 }}>
                {etaMin === 0 ? "Arriving any minute" : `Arriving in ${etaMin} min`}
              </div>
            )}
            {stale && <div style={{ fontSize: 12, marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Connection lost. Showing the last update.</div>}
          </div>

          {/* Map (needs the delivery address position) */}
          {!door && (
            <div style={{ height: 160, borderRadius: 22, border: "1px solid var(--line)", background: "var(--cream-deep)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, textAlign: "center" }}>
              {orderAddrDone ? (
                <>
                  <Icon name="map-pin" size={28} color="var(--faint)" />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>The map isn&apos;t available for this order</span>
                  <span className="small">Your progress below is still live.</span>
                </>
              ) : (
                <div className="skeleton" style={{ position: "absolute", inset: 0 }} />
              )}
            </div>
          )}
          {door && (
            <div style={{ position: "relative", width: "100%", height: 320, borderRadius: 22, overflow: "hidden", border: "1px solid var(--line)", boxShadow: "var(--shadow-card)" }}>
              <div ref={mapEl} style={{ width: "100%", height: "100%" }} />
              {tracking.rider?.lastLocationAt && (
                <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 500, background: "var(--white)", borderRadius: 9999, padding: "5px 12px", fontSize: 12, fontWeight: 700, boxShadow: "var(--shadow-card)" }}>
                  Updated {ago(tracking.rider.lastLocationAt, now)}
                </div>
              )}
            </div>
          )}

          {/* Delivery code */}
          {otp && active && (
            <div style={{ background: "var(--yellow-soft)", border: "1.5px dashed var(--amber)", borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--maroon)", textTransform: "uppercase" }}>Delivery code</span>
                <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Tell this code to your delivery partner at the door</p>
              </div>
              <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: 4, color: "var(--maroon)" }}>{otp}</span>
            </div>
          )}

          {/* Delivery partner */}
          {tracking.rider && (
            <div className="card" style={{ padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--yellow-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="user" size={24} color="var(--maroon)" />
                </div>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Delivery partner</span>
                  <h4 style={{ fontSize: 16, fontWeight: 800 }}>{tracking.rider.name}</h4>
                </div>
              </div>
              {tracking.rider.phone && (
                <a href={`tel:${tracking.rider.phone}`} className="btn btn-primary" style={{ padding: "10px 18px", fontSize: 13, gap: 6 }}>
                  <Icon name="phone" size={16} />
                  <span>Call</span>
                </a>
              )}
            </div>
          )}

          {/* Progress */}
          <div className="card" style={{ padding: 18 }}>
            {STEPS.map((st, i) => {
              const done = i <= reached;
              const t = times[i];
              return (
                <div key={st.key} style={{ display: "flex", gap: 14, alignItems: "flex-start", paddingBottom: i < STEPS.length - 1 ? 16 : 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: done ? "var(--green)" : "var(--cream-deep)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {done && <Icon name="check" size={13} color="#fff" />}
                    </span>
                    {i < STEPS.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 16, background: i < reached ? "var(--green)" : "var(--line)", marginTop: 2 }} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: done ? 800 : 600, color: done ? "var(--ink)" : "var(--muted)" }}>{st.label}</div>
                    {t && <div style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Delivering to */}
          {addr && (
            <div className="card" style={{ padding: 18, display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--green-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="map-pin" size={14} color="var(--green)" />
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Delivering to</span>
                <p style={{ fontSize: 14, fontWeight: 700 }}>
                  {[addr.line1, addr.landmark && `Near ${addr.landmark}`, addr.locality, addr.pincode].filter(Boolean).join(", ")}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
