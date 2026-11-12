"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCities, getLocalities } from "../../lib/api";
import type { Locality } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { MapPinPicker } from "../map/MapPinPicker";

/** Darjeeling / Siliguri area, used when nothing else is known yet. */
const DEFAULT_CENTER = { lat: 26.7271, lng: 88.3953 };

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const LocationModal: React.FC = () => {
  const router = useRouter();
  const { isLocationModalOpen, setIsLocationModalOpen, place, setPlace } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual city/locality selection
  const [cities, setCities] = useState<{ id: string; name: string }[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>("");

  useEffect(() => {
    if (isLocationModalOpen) {
      getCities()
        .then((res) => {
          setCities(res);
          if (res[0]) setSelectedCity(res[0].id);
        })
        .catch(() => undefined);
    }
  }, [isLocationModalOpen]);

  useEffect(() => {
    if (selectedCity) {
      getLocalities(selectedCity)
        .then((res) => setLocalities(res))
        .catch(() => setLocalities([]));
    }
  }, [selectedCity]);

  // Map mode: pick any point on the map. `center` moves the map; `pin` is where the marker currently is.
  const [mapMode, setMapMode] = useState(false);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [pin, setPin] = useState(DEFAULT_CENTER);

  const openMap = () => {
    const start = place ? { lat: place.lat, lng: place.lng } : localities[0] ? localities[0].location : DEFAULT_CENTER;
    setCenter(start);
    setPin(start);
    setError(null);
    setMapMode(true);
  };

  useEffect(() => {
    if (!isLocationModalOpen) setMapMode(false);
  }, [isLocationModalOpen]);

  /** Recentre the map on the browser's location. */
  const locateOnMap = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(p);
        setPin(p);
      },
      () => setError("Location permission denied. Drag the pin to your spot instead."),
      { timeout: 10000 }
    );
  };

  const handleConfirmPin = async () => {
    setLoading(true);
    setError(null);
    // Name the spot after a locality that is close by, otherwise just call it a pinned location.
    const near = localities.map((l) => ({ l, d: metres(pin, l.location) })).sort((a, b) => a.d - b.d)[0];
    const label = near && near.d < 2000 ? near.l.name : "Pinned location";
    try {
      const res = await setPlace({ label, lat: pin.lat, lng: pin.lng });
      setLoading(false);
      setIsLocationModalOpen(false);
      if (!res.deliverable) router.push(`/outside?lat=${pin.lat}&lng=${pin.lng}`);
    } catch {
      setLoading(false);
      setError("Could not resolve this location. Please move the pin or pick a locality.");
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          const res = await setPlace({
            label: "Current Location",
            lat,
            lng,
          });

          setLoading(false);
          if (res.deliverable) {
            setIsLocationModalOpen(false);
          } else {
            setIsLocationModalOpen(false);
            router.push(`/outside?lat=${lat}&lng=${lng}`);
          }
        } catch {
          setLoading(false);
          setError("Could not resolve this location. Please pick a locality from the list.");
        }
      },
      () => {
        setLoading(false);
        setError("Location permission denied. Please select your locality below.");
      },
      { timeout: 10000 }
    );
  };

  const handleSelectLocality = async (loc: Locality) => {
    setLoading(true);
    setError(null);
    try {
      const res = await setPlace({
        label: loc.name,
        lat: loc.location.lat,
        lng: loc.location.lng,
        localityId: loc.id,
      });
      setLoading(false);
      if (res.deliverable) {
        setIsLocationModalOpen(false);
      } else {
        setIsLocationModalOpen(false);
        router.push(`/outside?localityId=${encodeURIComponent(loc.id)}&locality=${encodeURIComponent(loc.name)}`);
      }
    } catch {
      setLoading(false);
      setError("Could not set this locality. Please try another.");
    }
  };

  return (
    <Modal
      isOpen={isLocationModalOpen}
      onClose={() => setIsLocationModalOpen(false)}
      title="Choose delivery location"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {place && (
          <div
            style={{
              padding: "12px 16px",
              background: "var(--yellow-soft)",
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Icon name="map-pin" size={18} color="var(--maroon)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                Delivering to
              </span>
              <p style={{ fontSize: 14, fontWeight: 800, color: "var(--maroon)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {place.label}
              </p>
            </div>
          </div>
        )}

        {mapMode ? (
          <>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Drag the pin or tap the map to mark where we should deliver.</p>
            <MapPinPicker initialLat={center.lat} initialLng={center.lng} onChange={setPin} />
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="soft" onClick={locateOnMap} style={{ flex: 1, gap: 8 }}>
                <Icon name="navigation" size={16} />
                <span>My location</span>
              </Button>
              <Button variant="primary" onClick={handleConfirmPin} loading={loading} style={{ flex: 1 }}>
                Confirm location
              </Button>
            </div>
            <button onClick={() => setMapMode(false)} style={{ fontSize: 13, fontWeight: 700, color: "var(--maroon)", alignSelf: "center" }}>
              ← Back to localities
            </button>
          </>
        ) : (
          <>
            {/* Current Location Button */}
            <Button variant="primary" onClick={handleUseCurrentLocation} loading={loading} style={{ width: "100%", gap: 8 }}>
              <Icon name="navigation" size={18} />
              <span>Use my current GPS location</span>
            </Button>
            <Button variant="soft" onClick={openMap} style={{ width: "100%", gap: 8 }}>
              <Icon name="map-pin" size={18} />
              <span>Choose on map</span>
            </Button>
          </>
        )}

        {error && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--red-soft)",
              color: "var(--red)",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        {!mapMode && (
          <>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
            OR SELECT LOCALITY
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>

        {/* City Selector */}
        {cities.length > 1 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {cities.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCity(c.id)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 9999,
                  fontSize: 13,
                  fontWeight: 700,
                  border: `1.5px solid ${selectedCity === c.id ? "var(--maroon)" : "var(--line)"}`,
                  background: selectedCity === c.id ? "var(--maroon)" : "var(--card)",
                  color: selectedCity === c.id ? "var(--white)" : "var(--ink)",
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Localities list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
          {localities.map((loc) => (
            <div
              key={loc.id}
              onClick={() => handleSelectLocality(loc)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderRadius: 12,
                background: "var(--cream)",
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name="map-pin" size={16} color="var(--muted)" />
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{loc.name}</span>
              </div>
              <Icon name="chevron-right" size={16} color="var(--muted)" />
            </div>
          ))}
          {localities.length === 0 && (
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", padding: 16 }}>
              No localities found for this city.
            </p>
          )}
        </div>
          </>
        )}
      </div>
    </Modal>
  );
};
