"use client";

import { useEffect, useState } from "react";
import Roles from "./roles";
import StaffLogin from "./staff-login";
import Staff from "./staff";
import CitiesLocalities from "./cities-localities";
import ZonesEditor from "./zones-editor";
import Warehouses from "./warehouses";
import Catalog from "./catalog";
import Inventory from "./inventory";
import Dispatch from "./dispatch";
import Riders from "./riders";
import CashDesk from "./cash";
import PaymentsDesk from "./payments";
import Notifications from "./notifications";
import Overview from "./overview";
import Orders from "./orders";
import Settings from "./settings";
import Coupons from "./coupons";
import Banners from "./banners";
import { readAdminSession, type AdminSession } from "./session-client";
import "./admin.css";

const groups = [
  { label: "Workspace", items: ["Overview", "Orders"] },
  { label: "Operations", items: ["Dispatch board"] },
  { label: "Fleet", items: ["Riders & fleet"] },
  { label: "Finance", items: ["Payments & refunds", "Cash & settlement"] },
  { label: "Engagement", items: ["Notifications & demand", "Coupons", "Banners"] },
  { label: "Organization", items: ["Warehouses", "Zones & localities", "Staff", "Roles & permissions"] },
  { label: "Catalog", items: ["Products & categories"] },
  { label: "Inventory", items: ["Offerings & stock"] },
  { label: "Administration", items: ["Settings"] },
];
const iconPaths: Record<string, string> = {
  Overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  Orders: "M7 3h10l3 4v14H4V7z M4 7h16 M9 11h6 M9 15h6",
  "Dispatch board": "M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5",
  "Riders & fleet": "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z",
  "Payments & refunds": "M3 7h18v12H3z M3 11h18 M7 15h4",
  "Cash & settlement": "M12 2v20 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  "Notifications & demand": "M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9",
  Warehouses: "M3 21V8l9-5 9 5v13 M3 21h18 M8 21V11h8v10 M8 15h8",
  "Zones & localities": "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  Staff: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-3.87",
  "Roles & permissions": "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6",
  "Products & categories": "M4 6h16 M4 10h16 M4 14h10 M4 18h6",
  "Offerings & stock": "M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z M4 13h2v-2H4z M18 13h2v-2h-2z M7 13h10v-2H7z",
  Settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  Coupons: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z M14 6v12",
  Banners: "M3 5h18v14H3z M3 15l5-5 4 4 3-3 6 6",
  Menu: "M4 6h16 M4 12h16 M4 18h16",
  Lock: "M7 11V7a5 5 0 0 1 10 0v4 M5 11h14v10H5z M12 15v2",
};
function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}

export default function AdminPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navClosed, setNavClosed] = useState(false);
  const [section, setSection] = useState("Overview");
  const [geoTab, setGeoTab] = useState<"zones" | "cities">("zones");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [logoutError, setLogoutError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionCheckError, setSessionCheckError] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [navRestored, setNavRestored] = useState(false);
  // Keep the current page across refreshes via the URL hash.
  useEffect(() => {
    try {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (h) setSection(h);
    } catch { /* ignore malformed hash */ }
    setNavRestored(true);
  }, []);
  useEffect(() => {
    if (!navRestored) return;
    const hash = section === "Overview" ? "" : `#${encodeURIComponent(section)}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }, [section, navRestored]);
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
  const available = (item: string) =>
    item === "Overview" ||
    (item === "Orders" && can("orders:view")) ||
    (item === "Settings" && (can("settings:view") || can("delivery_rules:manage") || can("warehouses:view") || can("warehouses:manage"))) ||
    (item === "Staff" && can("staff:manage")) ||
    (item === "Roles & permissions" && can("roles:manage") && session.user.scope.all) ||
    (item === "Zones & localities" && can("zones:manage") && session.user.scope.all) ||
    (item === "Warehouses" && (can("warehouses:view") || can("warehouses:manage"))) ||
    (item === "Products & categories" && (can("catalog:manage") || can("catalog:view"))) ||
    (item === "Offerings & stock" && (can("stock:manage") || can("stock:view") || can("warehouse_catalog:manage") || can("warehouse_catalog:view") || can("warehouses:view") || can("warehouses:manage"))) ||
    (item === "Dispatch board" && can("dispatch:manage")) ||
    (item === "Riders & fleet" && (can("riders:manage") || can("riders:view"))) ||
    (item === "Cash & settlement" && can("cash:manage")) ||
    (item === "Payments & refunds" && (can("refunds:manage") || can("payments:view"))) ||
    ((item === "Coupons" || item === "Banners") && can("pricing:manage")) ||
    (item === "Notifications & demand" && (can("notifications:manage") || can("notify_demand:view")));
  return <div className="admin-shell">
    <a className="admin-skip" href="#admin-main">Skip to content</a>
    <aside id="admin-navigation" className={`admin-sidebar ${menuOpen ? "is-open" : ""} ${navClosed ? "is-closed" : ""}`} aria-label="Admin navigation" onMouseLeave={() => setNavClosed(false)}>
      <a className="admin-brand" href="/admin"><span className="admin-brand-mark">ds.</span><span>Darjeeling Stores<small>Administration</small></span></a>
      <nav aria-label="Workspace sections">{groups.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(item => <button key={item} disabled={!available(item)} aria-current={item === section ? "page" : undefined} onClick={(e) => { setSection(item); setMenuOpen(false); setNavClosed(true); e.currentTarget.blur(); }}><Icon name={item} /><span>{item}</span>{!available(item) && <small>Soon<span className="admin-sr-only"> — Coming soon</span></small>}</button>)}</div>)}</nav>
      <div className="admin-sidebar-note"><Icon name="Lock" /><span>Staff session<small>Secure administration access</small></span></div>
      <div className="admin-account"><span className="admin-avatar" aria-hidden="true">DS</span><div>{session.user.name}<small>{session.user.phone} · {session.user.role}</small><button className="admin-signout" onClick={logout}>Sign out</button></div></div>
    </aside>
    {menuOpen && <button className="admin-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="admin-workspace">
      <header className="admin-topbar"><div className="admin-breadcrumb"><button className="admin-menu" aria-label="Toggle navigation" aria-controls="admin-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name="Menu" /></button><span>Workspace</span><span className="admin-slash" aria-hidden="true">/</span><strong>{section}</strong></div><span className="admin-connection"><span aria-hidden="true" />Signed in</span></header>
      <main className="admin-content" id="admin-main">
        {section === "Staff" ? <Staff userId={session.user.id} onSignOut={() => { setSession(null); setSection("Overview"); }} /> : section === "Roles & permissions" ? <Roles /> : section === "Zones & localities" ? <div>
          <div className="admin-tab-nav" role="tablist">
            <button
              role="tab"
              aria-selected={geoTab === "zones"}
              className={geoTab === "zones" ? "is-active" : ""}
              onClick={() => setGeoTab("zones")}
            >
              Delivery Zones &amp; Map
            </button>
            <button
              role="tab"
              aria-selected={geoTab === "cities"}
              className={geoTab === "cities" ? "is-active" : ""}
              onClick={() => setGeoTab("cities")}
            >
              Cities &amp; Localities
            </button>
          </div>
          {geoTab === "zones" ? <ZonesEditor session={session} /> : <CitiesLocalities />}
        </div> : section === "Coupons" ? <Coupons session={session} /> : section === "Banners" ? <Banners session={session} /> : section === "Warehouses" ? <Warehouses session={session} /> : section === "Products & categories" ? <Catalog session={session} /> : section === "Offerings & stock" ? <Inventory session={session} /> : section === "Dispatch board" ? <Dispatch session={session} /> : section === "Riders & fleet" ? <Riders session={session} /> : section === "Cash & settlement" ? <CashDesk session={session} /> : section === "Payments & refunds" ? <PaymentsDesk session={session} /> : section === "Notifications & demand" ? <Notifications session={session} /> : section === "Orders" ? <Orders session={session} /> : section === "Settings" ? <Settings session={session} /> : <Overview session={session} onNavigate={setSection} />}
        <footer className="admin-footer"><span>Darjeeling Stores</span><span>Administration workspace</span></footer>
      </main>
    </div>
  </div>;
}
