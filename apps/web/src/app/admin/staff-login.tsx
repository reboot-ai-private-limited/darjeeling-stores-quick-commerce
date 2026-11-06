"use client";
import { useEffect, useState, type FormEvent } from "react";
import { readAdminSession, type AdminSession } from "./session-client";
import DevLogin from "./dev-login";

export default function StaffLogin({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const [step, setStep] = useState<"login" | "change_password" | "enrol_2fa">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [development, setDevelopment] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/v1/admin/auth/status", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const { data } = await response.json();
      if (active && ["change_password", "enrol_2fa"].includes(data?.nextAction)) setStep(data.nextAction);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  async function send(path: string, body: object) {
    const response = await fetch(`/api/v1/admin/auth/${path}`, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "1", "X-Client": "admin" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      if (result.error?.code === "TOTP_REQUIRED") { setNeedsCode(true); setCode(""); }
      throw new Error(result.error?.message ?? "Sign-in could not be completed.");
    }
    return result.data;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (step === "change_password" && newPassword !== confirmation) throw new Error("The new passwords do not match.");
      const data = step === "login" ? await send("login", { email, password, ...(needsCode && { totpCode: code }) })
        : step === "change_password" ? await send("change-password", { newPassword }) : await send("2fa/enable", { code });
      setCode(""); setSecret(""); setNewPassword(""); setConfirmation("");
      if (data.nextAction) { setPassword(""); setStep(data.nextAction); return; }
      const session = await readAdminSession();
      if (!session) throw new Error("Sign-in could not be confirmed. Please sign in again.");
      setPassword(""); onLogin(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in is unavailable."); }
    finally { setBusy(false); }
  }
  async function setup() {
    setBusy(true); setError("");
    try { const data = await send("2fa/setup", {}); setSecret(data.secret); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Authenticator setup failed."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setError("");
    try { await send("cancel", {}); setStep("login"); setPassword(""); setNewPassword(""); setConfirmation(""); setCode(""); setSecret(""); setNeedsCode(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  if (development) return <><DevLogin onLogin={onLogin} /><button className="admin-return-login" onClick={() => setDevelopment(false)}>Use email and password</button></>;
  return <main className="admin-login-screen"><section className="admin-login-card" aria-labelledby="staff-login-title">
    <a className="admin-brand" href="/admin"><span className="admin-brand-mark">ds.</span><span>Darjeeling Stores<small>Administration</small></span></a>
    <h1 id="staff-login-title">{step === "login" ? "Sign in to your workspace" : step === "change_password" ? "Choose your own password" : "Set up your authenticator"}</h1>
    <p>{step === "login" ? "Use your staff email and password." : step === "change_password" ? "Replace your temporary password before entering the workspace." : "Add this account to your authenticator app, then enter its six-digit code."}</p>
    <form onSubmit={submit} aria-busy={busy}>
      {step === "login" && <><label htmlFor="staff-email">Email</label><input id="staff-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
        <label htmlFor="staff-password">Password</label><input id="staff-password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></>}
      {step === "change_password" && <><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={busy} aria-describedby="password-help" />
        <p id="password-help">Use at least 10 characters and a different password.</p><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></>}
      {step === "enrol_2fa" && <>{secret ? <div className="admin-authenticator-key"><strong>Manual setup key</strong><code>{secret}</code><p>Choose a time-based code in your authenticator app. Keep this key private.</p></div> : <button type="button" className="admin-role-button" disabled={busy} onClick={() => void setup()}>Show setup key</button>}</>}
      {(needsCode || step === "enrol_2fa") && <><label htmlFor="authenticator-code">Authenticator code</label><input id="authenticator-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={event => setCode(event.target.value)} disabled={busy || (step === "enrol_2fa" && !secret)} /></>}
      <p className="admin-login-error" role="alert">{error}</p><button className="admin-login-submit" disabled={busy || (step === "enrol_2fa" && !secret)}>{busy ? "Please wait…" : step === "login" ? "Sign in" : step === "change_password" ? "Save password and continue" : "Verify and continue"}</button>
      {step !== "login" && <button className="admin-login-back" type="button" disabled={busy} onClick={() => void cancel()}>Cancel and return to sign-in</button>}
    </form>
    {process.env.NODE_ENV === "development" && step === "login" && <button className="admin-login-back" type="button" onClick={() => setDevelopment(true)}>Use development OTP</button>}
  </section></main>;
}
