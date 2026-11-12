"use client";

import React, { useEffect, useState } from "react";
import { createAddress, getCities, getLocalities, updateAddress, uploadMedia } from "../../lib/api";
import type { Address, AddressInput, Locality } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { MapPinPicker } from "../map/MapPinPicker";
import { VoiceNoteRecorder } from "./VoiceNoteRecorder";

interface AddressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (addr: Address) => void;
  editAddress?: Address | null;
  defaultLat?: number;
  defaultLng?: number;
}

export const AddressModal: React.FC<AddressModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editAddress,
  defaultLat = 27.041,
  defaultLng = 88.2663,
}) => {
  const { place, user } = useStore();

  const [label, setLabel] = useState<"Home" | "Work" | "Other">("Home");
  const [line1, setLine1] = useState("");
  const [landmark, setLandmark] = useState("");
  const [localityId, setLocalityId] = useState<string>("");
  const [pincode, setPincode] = useState("734101");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [lat, setLat] = useState(defaultLat);
  const [lng, setLng] = useState(defaultLng);
  const [isDefault, setIsDefault] = useState(true);

  const [localities, setLocalities] = useState<Locality[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<{ blob: Blob; duration: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize data on open
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    getCities()
      .then(async (cities) => {
        const lists = await Promise.all(cities.map((c) => getLocalities(c.id).catch(() => [])));
        if (!mounted) return;
        const all = lists.flat();
        setLocalities(all);

        if (editAddress) {
          setLabel((editAddress.label as "Home" | "Work" | "Other") || "Home");
          setLine1(editAddress.line1 ?? "");
          setLandmark(editAddress.landmark ?? "");
          setLocalityId(editAddress.localityId ?? all[0]?.id ?? "");
          setPincode(editAddress.pincode ?? "734101");
          setContactName(editAddress.contactName ?? "");
          setContactPhone((editAddress.contactPhone ?? "").replace(/^\+91/, ""));
          setDeliveryNotes(editAddress.deliveryNotes ?? "");
          setLat(editAddress.location?.lat ?? editAddress.lat ?? defaultLat);
          setLng(editAddress.location?.lng ?? editAddress.lng ?? defaultLng);
          setIsDefault(editAddress.isDefault ?? true);
        } else {
          // Default to place if available
          const matchLoc = all.find((l) => l.id === place?.localityId || l.name === place?.label);
          if (matchLoc) {
            setLocalityId(matchLoc.id);
            setLat(matchLoc.location.lat);
            setLng(matchLoc.location.lng);
          } else if (all[0]) {
            setLocalityId(all[0].id);
            setLat(all[0].location.lat);
            setLng(all[0].location.lng);
          }
          if (user) {
            setContactName(user.name ?? "");
            setContactPhone((user.phone ?? "").replace(/^\+91/, ""));
          }
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [isOpen, editAddress, place, user, defaultLat, defaultLng]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPhotoFile(e.target.files[0]);
    }
  };

  const handleLocalityChange = (id: string) => {
    setLocalityId(id);
    const loc = localities.find((l) => l.id === id);
    if (loc) {
      setLat(loc.location.lat);
      setLng(loc.location.lng);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!localityId) {
      setError("Please select a locality.");
      return;
    }
    if (!line1.trim() || line1.trim().length < 2) {
      setError("Please enter your flat, house, or building number.");
      return;
    }
    if (!landmark.trim() || landmark.trim().length < 2) {
      setError("Landmark is required to help our riders locate your door.");
      return;
    }
    if (!contactName.trim() || contactName.trim().length < 2) {
      setError("Please provide a contact name.");
      return;
    }
    const cleanPhone = contactPhone.trim().replace(/^\+91/, "").replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setError("Please enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (!/^\d{6}$/.test(pincode.trim())) {
      setError("Please enter a valid 6-digit PIN code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let housePhotoMediaId: string | null | undefined;
      let voiceMediaId: string | null | undefined;

      // Upload house photo if selected
      if (photoFile) {
        housePhotoMediaId = await uploadMedia("address_photo", photoFile, photoFile.name, photoFile.type);
      }

      // Upload voice note if recorded
      if (voiceBlob) {
        voiceMediaId = await uploadMedia(
          "address_voice",
          voiceBlob.blob,
          "voice.webm",
          "audio/webm",
          { durationSec: voiceBlob.duration }
        );
      }

      const payload: AddressInput = {
        label,
        line1: line1.trim(),
        localityId,
        pincode: pincode.trim(),
        landmark: landmark.trim(),
        contactName: contactName.trim(),
        contactPhone: `+91${cleanPhone}`,
        location: { lat, lng },
        deliveryNotes: deliveryNotes.trim() || null,
        makeDefault: isDefault,
        ...(housePhotoMediaId !== undefined ? { housePhotoMediaId } : {}),
        ...(voiceMediaId !== undefined ? { voiceMediaId } : {}),
      };

      const saved = editAddress
        ? await updateAddress(editAddress.id, payload)
        : await createAddress(payload);

      setLoading(false);
      onSuccess(saved);
      onClose();
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to save address. Please check fields.");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editAddress ? "Edit Delivery Address" : "Add Delivery Address"}
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Map pin picker */}
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Adjust Delivery Pin on Map
          </span>
          <MapPinPicker
            initialLat={lat}
            initialLng={lng}
            onChange={(pt) => {
              setLat(pt.lat);
              setLng(pt.lng);
            }}
          />
        </div>

        {/* Address tag chips */}
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
            Save As
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {(["Home", "Work", "Other"] as const).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setLabel(tag)}
                style={{
                  padding: "6px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  border: `1.5px solid ${label === tag ? "var(--maroon)" : "var(--line)"}`,
                  background: label === tag ? "var(--maroon)" : "var(--card)",
                  color: label === tag ? "var(--white)" : "var(--ink)",
                  cursor: "pointer",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Locality Selector */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 4 }}>
            Locality / Area <span style={{ color: "var(--red)" }}>*</span>
          </label>
          <select
            value={localityId}
            onChange={(e) => handleLocalityChange(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--cream)",
              outline: "none",
              fontSize: 14,
              color: "var(--ink)",
            }}
          >
            {localities.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        {/* Flat / Building line */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 4 }}>
            House / Flat / Floor / Building <span style={{ color: "var(--red)" }}>*</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Flat 3B, Pine View Apartments"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
          />
        </div>

        {/* Landmark (Mandatory) */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 4 }}>
            Nearby Landmark <span style={{ color: "var(--red)" }}>* (Required)</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Opposite Chowrasta Clock Tower"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
          />
        </div>

        {/* PIN & Delivery Notes */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 4 }}>
              PIN Code <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <input
              type="text"
              required
              maxLength={6}
              placeholder="e.g. 734101"
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 4 }}>
              Delivery Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Call before coming"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
            />
          </div>
        </div>

        {/* Contact info */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 4 }}>
              Receiver Name <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 4 }}>
              Receiver Phone <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <input
              type="tel"
              required
              maxLength={10}
              placeholder="10-digit mobile"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
            />
          </div>
        </div>

        {/* House photo upload */}
        <div style={{ background: "var(--cream)", borderRadius: 14, padding: 14, border: "1px solid var(--line)" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}>
            House Gate / Building Photo (Optional)
          </span>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Helps our delivery partner recognize your door instantly.
          </p>
          <input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ fontSize: 13 }} />
        </div>

        {/* Voice Note recorder */}
        <VoiceNoteRecorder
          onRecorded={(blob, duration) => setVoiceBlob({ blob, duration })}
          onClear={() => setVoiceBlob(null)}
        />

        {/* Default checkbox */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          <span>Set as default delivery address</span>
        </label>

        {error && <p style={{ fontSize: 13, color: "var(--red)", fontWeight: 600 }}>{error}</p>}

        <Button variant="primary" type="submit" loading={loading} style={{ width: "100%", padding: "14px", marginTop: 8 }}>
          Save Address
        </Button>
      </form>
    </Modal>
  );
};
