"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { deleteAddress, getAddresses } from "../../../lib/api";
import type { Address } from "../../../lib/types";
import { useStore } from "../../../state/StoreContext";
import { AddressModal } from "../../../components/address/AddressModal";
import { Icon } from "../../../components/ui/Icon";

export default function AddressesPage() {
  const { signedIn, setIsLoginModalOpen } = useStore();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Address | null>(null);

  const fetchAddresses = () => {
    setLoading(true);
    getAddresses()
      .then((res) => setAddresses(res))
      .catch(() => setAddresses([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (signedIn) {
      fetchAddresses();
    } else {
      setLoading(false);
    }
  }, [signedIn]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this address?")) return;
    try {
      await deleteAddress(id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      alert("Could not delete address. Please try again.");
    }
  };

  if (!signedIn) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "60px 16px" }}>
        <h2 className="title" style={{ marginBottom: 12 }}>Please sign in to view addresses</h2>
        <button className="btn btn-primary" onClick={() => setIsLoginModalOpen(true)}>
          Sign In
        </button>
      </main>
    );
  }

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/account" style={{ color: "var(--maroon)", display: "flex" }}>
            <Icon name="arrow-left" size={20} />
          </Link>
          <h1 className="title" style={{ fontSize: 22 }}>Saved Addresses</h1>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditTarget(null);
            setModalOpen(true);
          }}
          style={{ padding: "8px 18px", fontSize: 13 }}
        >
          + Add New
        </button>
      </div>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 100, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {!loading && addresses.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--yellow-soft)",
              color: "var(--maroon)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Icon name="map-pin" size={32} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--maroon)" }}>No saved addresses</h3>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4, marginBottom: 20 }}>
            Add your home or office address to checkout in seconds.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditTarget(null);
              setModalOpen(true);
            }}
          >
            Add Address
          </button>
        </div>
      )}

      {!loading && addresses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {addresses.map((addr) => (
            <div
              key={addr.id}
              className="card"
              style={{
                padding: "16px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "75%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      background: "var(--yellow-soft)",
                      color: "var(--maroon)",
                      fontWeight: 800,
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 6,
                      textTransform: "uppercase",
                    }}
                  >
                    {addr.label}
                  </span>
                  {addr.isDefault && (
                    <span
                      style={{
                        background: "var(--green-soft)",
                        color: "var(--green)",
                        fontWeight: 800,
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 6,
                      }}
                    >
                      Default
                    </span>
                  )}
                </div>

                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginTop: 4 }}>
                  {addr.line1}
                </p>
                <p style={{ fontSize: 13, color: "var(--muted)" }}>
                  Landmark: {addr.landmark} · {addr.localityName ?? addr.locality ?? ""}, {addr.pincode}
                </p>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Contact: {addr.contactName} ({addr.contactPhone})
                </p>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    setEditTarget(addr);
                    setModalOpen(true);
                  }}
                  className="btn-icon"
                  style={{ width: 34, height: 34 }}
                  title="Edit"
                >
                  <Icon name="edit-2" size={15} color="var(--maroon)" />
                </button>
                <button
                  onClick={() => handleDelete(addr.id)}
                  className="btn-icon"
                  style={{ width: 34, height: 34 }}
                  title="Delete"
                >
                  <Icon name="trash-2" size={15} color="var(--red)" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddressModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={fetchAddresses}
        editAddress={editTarget}
      />
    </main>
  );
}
