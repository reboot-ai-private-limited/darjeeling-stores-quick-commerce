"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { submitWaitlist } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";

export const dynamic = "force-dynamic";

function OutsideContent() {
  const searchParams = useSearchParams();
  const localityId = searchParams.get("localityId") ?? "";
  const locality = searchParams.get("locality") ?? "";
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const lat = latStr ? parseFloat(latStr) : undefined;
  const lng = lngStr ? parseFloat(lngStr) : undefined;

  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length !== 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const where = localityId ? { localityId } : lat !== undefined && lng !== undefined ? { lat, lng } : null;
      if (!where) {
        setError("Pick your delivery location first, then join the waitlist.");
        return;
      }
      await submitWaitlist(`+91${phone}`, where);
      setSubmitted(true);
    } catch {
      setError("Could not submit waitlist request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-container" style={{ textAlign: "center", padding: "60px 16px", maxWidth: 500, margin: "0 auto" }}>
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "var(--yellow-soft)",
          color: "var(--maroon)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon name="map-pin" size={40} color="var(--maroon)" />
      </div>

      <h1 className="title" style={{ fontSize: 24, marginBottom: 10 }}>
        We are not in your area yet!
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 24 }}>
        {locality
          ? `We don't deliver to ${locality} currently. Drop your phone number and we’ll notify you the moment we launch here!`
          : "We haven't expanded to this location yet. Join our waitlist to be first in line when we open nearby!"}
      </p>

      {submitted ? (
        <div
          style={{
            background: "var(--green-soft)",
            color: "var(--green)",
            padding: "16px 20px",
            borderRadius: 16,
            fontWeight: 700,
            fontSize: 15,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Icon name="check-circle" size={20} />
          <span>You&apos;re on the list! We&apos;ll message you when we arrive.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--card)",
              borderRadius: 14,
              border: "1.5px solid var(--line)",
              padding: "4px 14px",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>+91</span>
            <input
              type="tel"
              maxLength={10}
              placeholder="10-digit mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 15, fontWeight: 600, padding: "10px 0" }}
              autoFocus
            />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", fontWeight: 600 }}>{error}</p>}

          <Button variant="primary" type="submit" loading={loading} style={{ width: "100%", padding: "14px" }}>
            Notify Me When Available
          </Button>
        </form>
      )}

      <div style={{ marginTop: 24 }}>
        <Link href="/" style={{ color: "var(--maroon)", fontSize: 14, fontWeight: 700 }}>
          ← Back to Storefront
        </Link>
      </div>
    </main>
  );
}

export default function OutsidePage() {
  return (
    <Suspense fallback={<div className="page-container"><p>Loading...</p></div>}>
      <OutsideContent />
    </Suspense>
  );
}
