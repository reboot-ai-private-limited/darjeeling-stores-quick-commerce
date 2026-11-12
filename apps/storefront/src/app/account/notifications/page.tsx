"use client";

import React, { useEffect, useState } from "react";
import { getNotifPrefs, saveNotifPrefs, type NotifPrefs } from "../../../lib/account-api";
import { useStore } from "../../../state/StoreContext";
import { EmptyState, PageHeader } from "../../../components/ui/PageHeader";

const ROWS: { key: keyof NotifPrefs; title: string; text: string }[] = [
  { key: "promoPush", title: "Offers and deals", text: "Push notifications about discounts and new arrivals" },
  { key: "promoWhatsApp", title: "WhatsApp updates", text: "Offers and order news on WhatsApp" },
  { key: "cartReminders", title: "Cart reminders", text: "A nudge if you leave items in your cart" },
];

export default function NotificationPrefsPage() {
  const { signedIn, booting, setIsLoginModalOpen } = useStore();
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    getNotifPrefs()
      .then(setPrefs)
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load your settings."));
  }, [signedIn]);

  const toggle = async (key: keyof NotifPrefs) => {
    if (!prefs) return;
    const value = !prefs[key];
    setPrefs({ ...prefs, [key]: value });
    try {
      setPrefs(await saveNotifPrefs({ [key]: value }));
    } catch {
      setPrefs(prefs);
    }
  };

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 720 }}>
      <PageHeader title="Notifications" />
      {!booting && !signedIn && (
        <EmptyState
          icon="bell"
          title="Sign in first"
          text="Sign in to choose what we send you."
          action={<button className="btn btn-primary" onClick={() => setIsLoginModalOpen(true)}>Sign in</button>}
        />
      )}
      {err && <EmptyState icon="wifi-off" title="Couldn't load" text={err} />}
      {prefs && (
        <div className="card" style={{ padding: "4px 0" }}>
          {ROWS.map((r, i) => (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", borderBottom: i < ROWS.length - 1 ? "1px solid var(--line)" : "none" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{r.title}</div>
                <div className="small">{r.text}</div>
              </div>
              <button
                role="switch"
                aria-checked={prefs[r.key]}
                onClick={() => void toggle(r.key)}
                style={{ width: 46, height: 28, borderRadius: 14, background: prefs[r.key] ? "var(--green)" : "var(--cream-deep)", position: "relative", transition: "background .15s" }}
              >
                <span style={{ position: "absolute", top: 3, left: prefs[r.key] ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
