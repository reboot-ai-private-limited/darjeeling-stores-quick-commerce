"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { requestAccountDeletion } from "../../lib/api";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../../components/ui/Icon";

/** The working part of the Delete your account page: sign in if needed, confirm once, send the request, and leave. */
export const DeleteAccountPanel: React.FC = () => {
  const router = useRouter();
  const { signedIn, user, signOut, setIsLoginModalOpen } = useStore();
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestAccountDeletion(reason.trim() || undefined);
      await signOut(); // the server has already ended every session; this clears the page's own signed-in state
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't send your request. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 14, padding: 20, margin: "8px 0 28px", background: "var(--card)" };

  if (done) {
    return (
      <div style={box} role="status">
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Your request has been sent</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
          You have been signed out on every device. We will finish deleting your account as described above. If an order is still being delivered, we finish after it arrives.
        </p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => router.push("/")}>Back to home</button>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div style={box}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Sign in to delete your account</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
          Sign in with the mobile number you use for Darjeeling Stores. We use this to make sure only you can delete your account.
        </p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setIsLoginModalOpen(true)}>Sign in</button>
      </div>
    );
  }

  return (
    <div style={{ ...box, borderColor: "var(--red)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--red)", fontWeight: 800, marginBottom: 8 }}>
        <Icon name="alert-triangle" size={20} color="var(--red)" /> This can&apos;t be undone
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>
        You are signed in as <b style={{ color: "var(--ink)" }}>{user?.phone ?? "your account"}</b>. We will sign you out on every device and delete this account. You will not be able to see your past orders or use your coupons again.
      </p>
      <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 }} htmlFor="delete-reason">Why are you leaving? (optional)</label>
      <input
        id="delete-reason"
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
        style={{ width: "100%", padding: "11px 12px", border: "1px solid var(--line)", borderRadius: 10, fontSize: 14, marginBottom: 14 }}
      />
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, cursor: "pointer", marginBottom: 14 }}>
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I understand my account will be deleted and this can&apos;t be undone.</span>
      </label>
      {error && <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={!understood || busy}
          onClick={() => void send()}
          style={{ background: "var(--red)", color: "#fff", opacity: !understood || busy ? 0.5 : 1, cursor: !understood || busy ? "not-allowed" : "pointer" }}
        >
          {busy ? "Sending…" : "Delete my account"}
        </button>
        <button className="btn btn-outline" onClick={() => router.push("/account")}>Keep my account</button>
      </div>
    </div>
  );
};
