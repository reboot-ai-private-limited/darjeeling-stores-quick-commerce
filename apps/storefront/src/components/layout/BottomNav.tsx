"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";

export const BottomNav: React.FC = () => {
  const pathname = usePathname();
  const { signedIn, setIsLoginModalOpen } = useStore();

  const isHome = pathname === "/";
  const isCategories = pathname.startsWith("/categories") || pathname.startsWith("/category");
  const isOrders = pathname.startsWith("/account/orders") || pathname.startsWith("/orders");
  const isAccount = pathname === "/account" || pathname.startsWith("/account/");

  return (
    <nav className="bottom-nav mobile-only">
      <Link href="/" className={`bottom-tab ${isHome ? "active" : ""}`}>
        <Icon name="home" size={20} color={isHome ? "var(--maroon)" : "var(--muted)"} />
        <span>Home</span>
      </Link>

      <Link href="/categories" className={`bottom-tab ${isCategories ? "active" : ""}`}>
        <Icon name="grid" size={20} color={isCategories ? "var(--maroon)" : "var(--muted)"} />
        <span>Categories</span>
      </Link>

      <Link
        href={signedIn ? "/account/orders" : "#"}
        onClick={(e) => {
          if (!signedIn) {
            e.preventDefault();
            setIsLoginModalOpen(true);
          }
        }}
        className={`bottom-tab ${isOrders ? "active" : ""}`}
      >
        <Icon name="clock" size={20} color={isOrders ? "var(--maroon)" : "var(--muted)"} />
        <span>Orders</span>
      </Link>

      <Link
        href={signedIn ? "/account" : "#"}
        onClick={(e) => {
          if (!signedIn) {
            e.preventDefault();
            setIsLoginModalOpen(true);
          }
        }}
        className={`bottom-tab ${isAccount ? "active" : ""}`}
      >
        <Icon name="user" size={20} color={isAccount ? "var(--maroon)" : "var(--muted)"} />
        <span>Account</span>
      </Link>
    </nav>
  );
};
