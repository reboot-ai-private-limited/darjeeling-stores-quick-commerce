"use client";
import { useState, type FormEvent } from "react";
import { adminFetch, readAdminSession, type AdminSession } from "./session-client";
export default function Security({ onSession }: { onSession: (session: AdminSession | null) => void }) {
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await adminFetch(`/api/v1/admin/auth/2fa/${secret ? "enable" : "setup"}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "1", "X-Client": "admin" }, body: JSON.stringify(secret ? { code } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Authentication could not be updated.");
      if (!secret) setSecret(result.data.secret);
      else { setSecret(""); setCode(""); setMessage("Two-factor authentication is enabled. Your other sessions have ended."); onSession(await readAdminSession()); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <><div className="admin-heading"><div><h1>Security</h1><p>Protect your account with an authenticator app.</p></div></div><form className="admin-panel admin-role-form admin-staff-form" onSubmit={submit} aria-busy={busy}>
    <h2>Two-factor authentication</h2><p>Sign in within the last ten minutes before starting setup. If 2FA is already enabled, your existing authenticator stays in use.</p>
    {secret && <><div className="admin-authenticator-key"><strong>Manual setup key</strong><code>{secret}</code><p>Add this time-based key to your authenticator app. Keep it private.</p></div><label htmlFor="security-code">Authenticator code</label><input id="security-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required minLength={6} maxLength={6} value={code} onChange={event => setCode(event.target.value)} disabled={busy} /></>}
    {error && <p role="alert" className="admin-role-error">{error}</p>}{message && <p role="status">{message}</p>}<button className="admin-role-button" disabled={busy}>{busy ? "Please wait…" : secret ? "Verify and enable" : "Set up authenticator"}</button>
  </form></>;
}
