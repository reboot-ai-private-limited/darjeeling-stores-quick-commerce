"use client";

import React, { useEffect, useRef } from "react";
import type { Map, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapPinPickerProps {
  initialLat: number;
  initialLng: number;
  onChange: (point: { lat: number; lng: number }) => void;
}

export const MapPinPicker: React.FC<MapPinPickerProps> = ({
  initialLat,
  initialLng,
  onChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    let isMounted = true;

    // Dynamically import Leaflet on browser
    import("leaflet").then((L) => {
      if (!isMounted || !mapContainerRef.current) return;

      if (!mapRef.current) {
        const map = L.map(mapContainerRef.current).setView([initialLat, initialLng], 15);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);

        // Custom Leaflet pin icon
        const icon = L.divIcon({
          className: "custom-map-pin",
          html: `<div style="background: #401815; color: #ffc933; width: 34px; height: 34px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(64,24,21,0.3); border: 2px solid #ffffff;"><div style="transform: rotate(45deg); width: 10px; height: 10px; background: #ffc933; border-radius: 50%;"></div></div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 34],
        });

        const marker = L.marker([initialLat, initialLng], {
          draggable: true,
          icon,
        }).addTo(map);

        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          onChange({ lat: pos.lat, lng: pos.lng });
        });

        map.on("click", (e) => {
          marker.setLatLng(e.latlng);
          onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
        });

        mapRef.current = map;
        markerRef.current = marker;
      }
    });

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, []); // Run once on mount

  // Move the map and pin when the parent supplies a new centre (e.g. after "use my location").
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLatLng([initialLat, initialLng]);
    map.setView([initialLat, initialLng], Math.max(map.getZoom(), 15));
  }, [initialLat, initialLng]);

  return (
    <div className="map-container">
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
};
