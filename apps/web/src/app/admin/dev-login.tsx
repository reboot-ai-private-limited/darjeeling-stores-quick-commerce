"use client";

import { useState, type FormEvent } from "react";

export type AdminSession = { token: string; expiresAt: number; user: { name: string; phone: string; role: string } };

export default function DevLogin({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/auth/${requested ? "verify-otp" : "request-otp"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requested ? { phone, otp } : { phone, app: "admin" }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error?.message ?? "Sign-in unavailable. Check that the development API is running.");
      }
      const result = await response.json();
      if (!requested) { setRequested(true); return; }
      const token = result.data?.accessToken;
      if (typeof token !== "string") throw new Error("The API did not return a valid session.");
      const profileResponse = await fetch("/api/v1/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!profileResponse.ok) throw new Error("Your session could not be verified. Please sign in again.");
      const { data: user } = await profileResponse.json();
      if (!["super_admin", "admin"].includes(user?.role)) throw new Error("This account does not have admin access.");
      onLogin({ token, user, expiresAt: Date.now() + result.data.accessTokenExpiresInSeconds * 1000 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally { setBusy(false); }
  }
  const development = process.env.NODE_ENV === "development";
  return <main className="admin-login-screen"><section className="admin-login-card" aria-labelledby="login-title">
    <a className="admin-brand" href="/admin"><span className="admin-brand-mark">ds.</span><span>Darjeeling Stores<small>Administration</small></span></a>
    <h1 id="login-title">{requested ? "Enter your code" : "Sign in to your workspace"}</h1>
    <p>{requested ? `Enter the development OTP for ${phone}.` : "Use your administrator phone number to continue."}</p>
    {development ? <>
      <div className="admin-login-dev">Development access only · 9000000001 · OTP 000000</div>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="admin-phone">Phone number</label><input id="admin-phone" type="tel" autoComplete="tel" inputMode="tel" required maxLength={24} value={phone} disabled={busy || requested} onChange={event => setPhone(event.target.value)} placeholder="Enter phone number" />
        {requested && <><label htmlFor="admin-otp">One-time code</label><input id="admin-otp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus value={otp} disabled={busy} onChange={event => setOtp(event.target.value)} placeholder="6-digit code" /></>}
        <p className="admin-login-error" role="alert">{error}</p>
        <button className="admin-login-submit" disabled={busy}>{busy ? "Please wait…" : requested ? "Verify and sign in" : "Request code"}</button>
        {requested && <button className="admin-login-back" type="button" disabled={busy} onClick={() => { setRequested(false); setOtp(""); setError(""); }}>Use another number</button>}
      </form>
      <p className="admin-login-footnote">Sessions last 15 minutes. Refreshing this page signs you out of the UI.</p>
    </> : <p>Production sign-in is not available yet.</p>}
  </section></main>;
}
