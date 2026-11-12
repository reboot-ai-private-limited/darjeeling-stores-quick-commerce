"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getOrderGroup, uploadMedia } from "../../../../lib/api";
import { rupees } from "../../../../lib/theme";
import type { OrderGroup, OrderItem } from "../../../../lib/types";
import { Button } from "../../../../components/ui/Button";
import { Icon } from "../../../../components/ui/Icon";

export default function RefundRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = use(params);
  const router = useRouter();

  const [order, setOrder] = useState<OrderGroup | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [reason, setReason] = useState<string>("damaged");
  const [note, setNote] = useState<string>("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    getOrderGroup(orderId)
      .then((res) => setOrder(res))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [orderId]);

  const toggleItem = (variantId: string) => {
    setSelectedItems((prev) =>
      prev.includes(variantId) ? prev.filter((id) => id !== variantId) : [...prev, variantId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItems.length === 0) {
      setError("Please select at least one item to request a refund.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let photoId: string | null = null;
      if (photoFile) {
        photoId = await uploadMedia("refund_photo", photoFile, photoFile.name, photoFile.type);
      }

      await apiFetch("POST", `/orders/${encodeURIComponent(orderId)}/refund-request`, {
        items: selectedItems,
        reason,
        note: note.trim() || undefined,
        photoId,
      });

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit refund request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="page-container" style={{ padding: "40px 16px", maxWidth: 640, margin: "0 auto" }}>
        <div className="skeleton" style={{ height: 260, borderRadius: 8 }} />
      </main>
    );
  }

  const items = order?.children?.flatMap((c) => c.items ?? []) ?? [];

  return (
    <main className="page-container" style={{ padding: "20px 16px 60px", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href={`/orders/${orderId}`} style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1 className="title" style={{ fontSize: 22 }}>Report a Problem / Refund</h1>
      </div>

      {success ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--green-soft)",
              color: "var(--green)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Icon name="check-circle" size={36} color="var(--green)" />
          </div>
          <h2 className="title" style={{ fontSize: 20, marginBottom: 8 }}>Refund Request Submitted</h2>
          <p style={{ color: "var(--muted)", fontSize: 14, maxWidth: 400, margin: "0 auto 24px" }}>
            Our store team has received your report. We will review the details and initiate your refund within 2-4 hours.
          </p>
          <Link href={`/orders/${orderId}`} className="btn btn-primary">
            Back to Order
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Select Items */}
          <div className="card" style={{ padding: 18 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--maroon)", display: "block", marginBottom: 12 }}>
              Select affected items:
            </span>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((item) => {
                const isSelected = selectedItems.includes(item.variantId);
                return (
                  <label
                    key={item.variantId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: `1.5px solid ${isSelected ? "var(--maroon)" : "var(--line)"}`,
                      background: isSelected ? "var(--yellow-soft)" : "var(--card)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItem(item.variantId)}
                    />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{item.name}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
                        {item.variantLabel} · {rupees(item.lineTotal)}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Reason */}
          <div className="card" style={{ padding: 18 }}>
            <label style={{ fontSize: 14, fontWeight: 800, color: "var(--maroon)", display: "block", marginBottom: 8 }}>
              Reason for refund:
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none" }}
            >
              <option value="damaged">Damaged or rotten produce</option>
              <option value="missing">Item was missing from delivery</option>
              <option value="expired">Item expired or near expiration</option>
              <option value="wrong_item">Wrong item was delivered</option>
            </select>
          </div>

          {/* Upload Photo proof */}
          <div className="card" style={{ padding: 18 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--maroon)", display: "block", marginBottom: 4 }}>
              Upload Photo of Item (Optional but recommended)
            </span>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
              Clear photo of the damaged or wrong product helps speed up instant approval.
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && setPhotoFile(e.target.files[0])}
            />
          </div>

          {/* Note */}
          <div className="card" style={{ padding: 18 }}>
            <label style={{ fontSize: 14, fontWeight: 800, color: "var(--maroon)", display: "block", marginBottom: 8 }}>
              Additional Comments:
            </label>
            <textarea
              rows={3}
              placeholder="Tell us what went wrong..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none", resize: "none" }}
            />
          </div>

          {error && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 700 }}>{error}</p>}

          <Button variant="primary" type="submit" loading={submitting} style={{ padding: "16px", fontSize: 15 }}>
            Submit Refund Request
          </Button>
        </form>
      )}
    </main>
  );
}
