"use client";

import { useEffect, useState } from "react";
import Roles from "./roles";
import StaffLogin from "./staff-login";
import Staff from "./staff";
import Security from "./security";
import { readAdminSession, type AdminSession } from "./session-client";
import "./admin.css";

const groups = [
  { label: "Workspace", items: ["Overview", "Orders"] },
  { label: "Organization", items: ["Warehouses", "Zones & localities", "Staff", "Roles & permissions"] },
  { label: "Administration", items: ["Security", "Settings", "Audit log"] },
];
const iconPaths: Record<string, string> = {
  Overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  Orders: "M7 3h10l3 4v14H4V7z M4 7h16 M9 11h6 M9 15h6",
  Warehouses: "M3 21V8l9-5 9 5v13 M3 21h18 M8 21V11h8v10 M8 15h8",
  "Zones & localities": "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  Staff: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-3.87",
  "Roles & permissions": "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6",
  Security: "M7 11V7a5 5 0 0 1 10 0v4 M5 11h14v10H5z M12 15v2",
  Settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  "Audit log": "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",
  Menu: "M4 6h16 M4 12h16 M4 18h16",
  Lock: "M7 11V7a5 5 0 0 1 10 0v4 M5 11h14v10H5z M12 15v2",
};
function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}

export default function AdminPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState("Overview");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [logoutError, setLogoutError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionCheckError, setSessionCheckError] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setCheckingSession(true);
    setSessionCheckError("");
    void readAdminSession().then(value => { if (active) setSession(value); }, () => { if (active) setSessionCheckError("The sign-in service is unavailable. Check the API connection and try again."); }).finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, [checkAttempt]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const check = () => { void readAdminSession().then(value => { if (active) setSession(value); }, () => { /* A network outage is not proof of session revocation. */ }); };
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [session]);
  async function logout() {
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": "1", "X-Client": "admin" } });
      if (!response.ok) throw new Error("Logout failed");
    } catch { setLogoutError("Server logout could not be confirmed. Retry sign-out when the API is reachable; the refresh cookie may still be active."); }
    finally { setSession(null); setMenuOpen(false); setSection("Overview"); }
  }
  if (checkingSession || sessionCheckError) return <div className="admin-shell"><main className="admin-login-screen"><section className="admin-login-card"><h1>Darjeeling Stores</h1>{checkingSession ? <p role="status">Checking your session…</p> : <><p role="alert">{sessionCheckError}</p><button className="admin-login-submit" onClick={() => setCheckAttempt(value => value + 1)}>Try again</button></>}</section></main></div>;
  if (!session) return <div className="admin-shell"><StaffLogin onLogin={value => { setSession(value); setLogoutError(""); }} />{logoutError && <p className="admin-logout-warning" role="alert">{logoutError}<button className="admin-signout" onClick={logout}>Retry sign-out</button></p>}</div>;
  const can = (permission: string) => session.user.permissions.includes("*") || session.user.permissions.includes(permission);
  const available = (item: string) => item === "Overview" || item === "Security" || (item === "Staff" && can("staff:manage")) || (item === "Roles & permissions" && can("roles:manage") && session.user.scope.all);
  return <div className="admin-shell">
    <a className="admin-skip" href="#admin-main">Skip to content</a>
    <aside id="admin-navigation" className={`admin-sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Admin navigation">
      <a className="admin-brand" href="/admin"><span className="admin-brand-mark">ds.</span><span>Darjeeling Stores<small>Administration</small></span></a>
      <nav aria-label="Workspace sections">{groups.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(item => <button key={item} disabled={!available(item)} aria-current={item === section ? "page" : undefined} onClick={() => { setSection(item); setMenuOpen(false); }}><Icon name={item} /><span>{item}</span>{!available(item) && <small>Soon<span className="admin-sr-only"> — Coming soon</span></small>}</button>)}</div>)}</nav>
      <div className="admin-sidebar-note"><Icon name="Lock" /><span>Staff session<small>Secure administration access</small></span></div>
      <div className="admin-account"><span className="admin-avatar" aria-hidden="true">DS</span><div>{session.user.name}<small>{session.user.phone} · {session.user.role}</small><button className="admin-signout" onClick={logout}>Sign out</button></div></div>
    </aside>
    {menuOpen && <button className="admin-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="admin-workspace">
      <header className="admin-topbar"><div className="admin-breadcrumb"><button className="admin-menu" aria-label="Toggle navigation" aria-controls="admin-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name="Menu" /></button><span>Workspace</span><span className="admin-slash" aria-hidden="true">/</span><strong>{section}</strong></div><span className="admin-connection"><span aria-hidden="true" />Signed in</span></header>
      <main className="admin-content" id="admin-main">
        {section === "Staff" ? <Staff userId={session.user.id} onSignOut={() => { setSession(null); setSection("Overview"); }} /> : section === "Security" ? <Security onSession={setSession} /> : section === "Roles & permissions" ? <Roles /> : <>
        <div className="admin-heading"><div><h1>Overview</h1><p>Your store operations, in one place.</p></div><label className="admin-warehouse"><Icon name="Warehouses" /><select disabled aria-label="Warehouse selection unavailable"><option>Warehouses unavailable</option></select></label></div>
        <section className="admin-panel" aria-labelledby="admin-unavailable">
          <div className="admin-panel-toolbar"><h2>Workspace activity</h2><span>Awaiting connection</span></div>
          <div className="admin-empty"><span className="admin-empty-icon"><Icon name="Overview" /></span><h2 id="admin-unavailable">A clear view starts here.</h2><p>Orders, warehouses and team activity will appear here when admin services are connected.</p><span className="admin-empty-status"><Icon name="Lock" />Signed in securely</span></div>
          <div className="admin-panel-bottom"><span>No data has been loaded.</span><span>Admin features are coming soon.</span></div>
        </section>
        <section className="admin-availability" aria-labelledby="admin-availability-title"><div><h2 id="admin-availability-title">Before you get started</h2><p>The workspace is ready for the next stage of setup.</p></div><div className="admin-setup-rows"><div><Icon name="Lock" /><span><strong>Secure sign-in</strong><small>Staff authentication and session management</small></span><span className="admin-pending">Connected</span></div><div><Icon name="Warehouses" /><span><strong>Connect your operation</strong><small>Warehouse access and operational data</small></span><span className="admin-pending">Coming soon</span></div></div></section>
        <details className="admin-explanation"><summary>Why are the other sections unavailable?</summary><p>Staff sign-in, security, roles and account management are connected. Other operational sections are still being built. Navigation will become available as each service is connected. No sample records or operational metrics are displayed.</p></details>
        </>}
        <footer className="admin-footer"><span>Darjeeling Stores</span><span>Administration workspace</span></footer>
      </main>
    </div>
  </div>;
}
