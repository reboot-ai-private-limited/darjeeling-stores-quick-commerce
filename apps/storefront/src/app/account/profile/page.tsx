"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateProfile } from "../../../lib/api";
import { useStore } from "../../../state/StoreContext";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";

export default function EditProfilePage() {
  const router = useRouter();
  const { user, setUser } = useStore();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: { name?: string; email?: string } = { name: name.trim() };
      if (email.trim()) payload.email = email.trim();
      const updated = await updateProfile(payload);
      setUser(updated);
      setSuccess(true);
      setTimeout(() => router.push("/account"), 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 540, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href="/account" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1 className="title" style={{ fontSize: 22 }}>Edit Profile</h1>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}>
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none", fontSize: 15 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}>
              Email Address (Optional)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream)", outline: "none", fontSize: 15 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}>
              Mobile Number
            </label>
            <input
              type="text"
              disabled
              value={user?.phone ?? ""}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--cream-deep)", color: "var(--muted)", fontSize: 15, cursor: "not-allowed" }}
            />
            <span style={{ fontSize: 11, color: "var(--muted)", display: "block", marginTop: 4 }}>
              Phone number is linked to your login session.
            </span>
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", fontWeight: 600 }}>{error}</p>}
          {success && <p style={{ fontSize: 13, color: "var(--green)", fontWeight: 700 }}>Profile saved successfully!</p>}

          <Button variant="primary" type="submit" loading={loading} style={{ width: "100%", padding: "14px", marginTop: 8 }}>
            Save Changes
          </Button>
        </form>
      </div>
    </main>
  );
}
