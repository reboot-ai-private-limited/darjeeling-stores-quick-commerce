"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../../components/ui/Icon";

const MENU = [
  { href: "/account/orders", icon: "package", label: "My Orders" },
  { href: "/account/addresses", icon: "map-pin", label: "Saved Addresses" },
  { href: "/account/favourites", icon: "heart", label: "My Favourites" },
  { href: "/account/refunds", icon: "check-circle", label: "My Refunds" },
  { href: "/account/notify-me", icon: "bell", label: "Notify Me" },
  { href: "/account/notifications", icon: "bell", label: "Notification Settings" },
  { href: "/help", icon: "help-circle", label: "Help & Customer Support" },
];

export default function AccountPage() {
  const router = useRouter();
  const { user, signedIn, signOut, setIsLoginModalOpen } = useStore();

  if (!signedIn) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "80px 16px" }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--yellow-soft)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Icon name="user" size={36} color="var(--maroon)" />
        </div>
        <h2 className="title" style={{ marginBottom: 8 }}>Sign in to your account</h2>
        <p style={{ color: "var(--muted)", maxWidth: 360, margin: "0 auto 24px" }}>
          View your order history, manage addresses, and access your favourite items.
        </p>
        <button className="btn btn-primary" onClick={() => setIsLoginModalOpen(true)}>
          Sign In
        </button>
      </main>
    );
  }

  const handleSignOut = async () => {
    if (confirm("Are you sure you want to sign out?")) {
      await signOut();
      router.push("/");
    }
  };

  return (
    <main className="page-container" style={{ padding: "24px 16px 60px", maxWidth: 640, margin: "0 auto" }}>
      {/* Profile Header */}
      <div
        className="card"
        style={{
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--maroon)",
          color: "var(--white)",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--yellow)",
              color: "var(--maroon)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 900,
            }}
          >
            {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--white)" }}>
              {user?.name || "Darjeeling Customer"}
            </h2>
            <p style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.8)", marginTop: 2 }}>
              {user?.phone}
            </p>
          </div>
        </div>

        <Link
          href="/account/profile"
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.15)",
            color: "var(--white)",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Edit Profile
        </Link>
      </div>

      {/* Menu Links */}
      <div className="card" style={{ padding: "8px 0", display: "flex", flexDirection: "column" }}>
        {MENU.map((m, i) => (
          <Link
            key={m.href}
            href={m.href}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: i < MENU.length - 1 ? "1px solid var(--line)" : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Icon name={m.icon} size={20} color="var(--maroon)" />
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{m.label}</span>
            </div>
            <Icon name="chevron-right" size={18} color="var(--muted)" />
          </Link>
        ))}
      </div>

      {/* Sign Out Button */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <button
          onClick={handleSignOut}
          style={{
            padding: "12px 24px",
            borderRadius: 8,
            border: "1.5px solid var(--red)",
            background: "transparent",
            color: "var(--red)",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Sign Out of Darjeeling Stores
        </button>
        <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
          Darjeeling Stores Storefront v1.0.0
        </span>
      </div>
    </main>
  );
}
