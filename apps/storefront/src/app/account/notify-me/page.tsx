"use client";

import React, { useEffect, useState } from "react";
import { cancelNotifyMe, listNotifyMe, type NotifySub } from "../../../lib/account-api";
import { useStore } from "../../../state/StoreContext";
import { EmptyState, PageHeader } from "../../../components/ui/PageHeader";

export default function NotifyMePage() {
  const { signedIn, booting, setIsLoginModalOpen } = useStore();
  const [rows, setRows] = useState<NotifySub[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    listNotifyMe()
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load your list."));
  }, [signedIn]);

  const remove = async (id: string) => {
    setRows((r) => r?.filter((x) => x.id !== id) ?? r);
    try {
      await cancelNotifyMe(id);
    } catch {
      listNotifyMe().then(setRows).catch(() => undefined);
    }
  };

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px", maxWidth: 720 }}>
      <PageHeader title="Notify me" sub="We will tell you when these are back" />
      {!booting && !signedIn && (
        <EmptyState
          icon="bell"
          title="Sign in first"
          text="Sign in to manage your back-in-stock alerts."
          action={<button className="btn btn-primary" onClick={() => setIsLoginModalOpen(true)}>Sign in</button>}
        />
      )}
      {signedIn && !rows && !err && <div className="skeleton" style={{ height: 72 }} />}
      {err && <EmptyState icon="wifi-off" title="Couldn't load" text={err} />}
      {rows?.length === 0 && <EmptyState icon="bell" title="No alerts" text="Tap Notify me on a sold-out item and it will appear here." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows?.map((s) => (
          <div key={s.id} className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{s.name}</div>
              {s.variantLabel && <div className="small">{s.variantLabel}</div>}
            </div>
            <button className="btn btn-soft" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => void remove(s.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
