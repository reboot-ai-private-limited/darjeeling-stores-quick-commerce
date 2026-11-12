"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useStore } from "../../state/StoreContext";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";

const FAQS = [
  {
    q: "How fast will my order arrive?",
    a: "Orders in active delivery zones are dispatched immediately from our nearest store and usually arrive within 10–15 minutes.",
  },
  {
    q: "What payment methods are supported?",
    a: "We accept Cash on Delivery (COD), UPI (Google Pay, PhonePe, Paytm), All major Credit & Debit cards, and Netbanking via Razorpay.",
  },
  {
    q: "What if an item is damaged or missing?",
    a: "You can report any issue directly from your Orders page under 'Report a problem / Refund'. Attach a photo of the item and our team will process your refund promptly.",
  },
  {
    q: "How does pre-ordering work when the store is closed?",
    a: "When the store is closed for the night, you can choose a convenient delivery slot for the next morning during checkout.",
  },
];

export default function HelpPage() {
  const router = useRouter();
  const { signedIn, signOut } = useStore();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await apiFetch("POST", "/me/delete-request", { reason: deleteReason || "User requested deletion" });
      await signOut();
      alert("Account deletion request submitted. You have been signed out.");
      router.push("/");
    } catch {
      alert("Failed to submit account deletion request. Please contact support.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="page-container" style={{ padding: "20px 16px 60px", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/account" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1 className="title" style={{ fontSize: 22 }}>Help & Support</h1>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Contact Strip */}
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--maroon)" }}>Need instant assistance?</h3>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Our customer care team is available 7 days a week from 6:00 AM to 11:00 PM.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <a
              href="https://wa.me/919000000002?text=Hi%20Darjeeling%20Stores,%20I%20need%20help%20with%20my%20order"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{ padding: "12px", fontSize: 13, gap: 8, background: "#1f9d62" }}
            >
              <Icon name="message-circle" size={18} />
              <span>WhatsApp Chat</span>
            </a>

            <a
              href="tel:+919000000002"
              className="btn btn-outline"
              style={{ padding: "12px", fontSize: 13, gap: 8 }}
            >
              <Icon name="phone" size={18} />
              <span>Call Helpline</span>
            </a>
          </div>
        </div>

        {/* FAQs */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--maroon)", marginBottom: 14 }}>
            Frequently Asked Questions
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {FAQS.map((faq, i) => {
              const isExpanded = expandedFaq === i;
              return (
                <div
                  key={faq.q}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "12px 16px",
                    background: "var(--card)",
                  }}
                >
                  <button
                    onClick={() => setExpandedFaq(isExpanded ? null : i)}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{faq.q}</span>
                    <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color="var(--muted)" />
                  </button>
                  {isExpanded && (
                    <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Delete Account (Mandatory compliance) */}
        {signedIn && (
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button
              onClick={() => setDeleteModalOpen(true)}
              style={{ fontSize: 13, color: "var(--muted)", textDecoration: "underline" }}
            >
              Request to delete my account
            </button>
          </div>
        )}
      </div>

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Your Account"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            This will permanently remove your profile, saved addresses, and order history from Darjeeling Stores.
          </p>
          <textarea
            rows={3}
            placeholder="Reason for leaving (Optional)"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none", resize: "none" }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <Button variant="outline" onClick={() => setDeleteModalOpen(false)} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleDeleteAccount}
              loading={deleting}
              style={{ flex: 1, background: "var(--red)", borderColor: "var(--red)" }}
            >
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
