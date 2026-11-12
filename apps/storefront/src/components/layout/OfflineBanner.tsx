"use client";

import React, { useEffect, useState } from "react";
import { Icon } from "../ui/Icon";

/** Persistent bar shown while the browser has no connection. */
export const OfflineBanner: React.FC = () => {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  if (!offline) return null;
  return (
    <div style={{ background: "var(--ink)", color: "var(--white)", padding: "8px 16px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <Icon name="wifi-off" size={14} color="#fff" />
      You are offline. Some things may not load.
    </div>
  );
};
