"use client";
import { useEffect, useState, type FormEvent } from "react";
import { readAdminSession, type AdminSession } from "./session-client";
import DevLogin from "./dev-login";

export default function StaffLogin({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const [step, setStep] = useState<"login" | "change_password">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [development, setDevelopment] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/v1/admin/auth/status", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const { data } = await response.json();
      if (active && data?.nextAction === "change_password") setStep("change_password");
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  async function send(path: string, body: object) {
    const response = await fetch(`/api/v1/admin/auth/${path}`, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "1", "X-Client": "admin" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Sign-in could not be completed.");
    return result.data;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (step === "change_password" && newPassword !== confirmation) throw new Error("The new passwords do not match.");
      const data = step === "login" ? await send("login", { email, password }) : await send("change-password", { newPassword });
      setNewPassword(""); setConfirmation("");
      if (data.nextAction) { setPassword(""); setStep(data.nextAction); return; }
      const session = await readAdminSession();
      if (!session) throw new Error("Sign-in could not be confirmed. Please sign in again.");
      setPassword(""); onLogin(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in is unavailable."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setError("");
    try { await send("cancel", {}); setStep("login"); setPassword(""); setNewPassword(""); setConfirmation(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  if (development) return <><DevLogin onLogin={onLogin} /><button className="admin-return-login" onClick={() => setDevelopment(false)}>Use email and password</button></>;
  return <main className="admin-login-screen"><section className="admin-login-card" aria-labelledby="staff-login-title">
    <a className="admin-brand" href="/admin"><span className="admin-brand-mark">ds.</span><span>Darjeeling Stores<small>Administration</small></span></a>
    <h1 id="staff-login-title">{step === "login" ? "Sign in to your workspace" : "Choose your own password"}</h1>
    <p>{step === "login" ? "Use your staff email and password." : "Replace your temporary password before entering the workspace."}</p>
    <form onSubmit={submit} aria-busy={busy}>
      {step === "login" && <><label htmlFor="staff-email">Email</label><input id="staff-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
        <label htmlFor="staff-password">Password</label><input id="staff-password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></>}
      {step === "change_password" && <><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={busy} aria-describedby="password-help" />
        <p id="password-help">Use at least 10 characters and a different password.</p><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></>}
      <p className="admin-login-error" role="alert">{error}</p><button className="admin-login-submit" disabled={busy}>{busy ? "Please wait…" : step === "login" ? "Sign in" : "Save password and continue"}</button>
      {step !== "login" && <button className="admin-login-back" type="button" disabled={busy} onClick={() => void cancel()}>Cancel and return to sign-in</button>}
    </form>
    {process.env.NODE_ENV === "development" && step === "login" && <button className="admin-login-back" type="button" onClick={() => setDevelopment(true)}>Use development OTP</button>}
  </section></main>;
}
