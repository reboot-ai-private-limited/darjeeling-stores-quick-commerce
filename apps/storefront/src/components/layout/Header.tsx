"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";

const HINTS = ["tea", "snacks", "spices", "gift boxes", "biscuits"];

/** Maroon hero header, like the app: big delivery-time headline, location, bell/account, and a pinned white search pill. */
export const Header: React.FC = () => {
  const router = useRouter();
  const { place, zone, storeStatus, count, signedIn, setIsLocationModalOpen, setIsCartDrawerOpen, setIsLoginModalOpen } = useStore();

  const [hintIndex, setHintIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setHintIndex((prev) => (prev + 1) % HINTS.length), 2600);
    return () => clearInterval(timer);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  const headline = storeStatus
    ? storeStatus.accepting
      ? `Delivery in ${storeStatus.etaMaxMinutes} minutes`
      : "Store is closed right now"
    : "Delivery in minutes";
  const address = place ? place.label : zone ? zone.name : "Choose location";

  const goAccount = (e: React.MouseEvent, href: string) => {
    if (!signedIn) {
      e.preventDefault();
      setIsLoginModalOpen(true);
    } else {
      void href;
    }
  };

  return (
    <header className="main-header">
      <div className="page-container header-top">
        <Link href="/" className="brand-logo desktop-only" aria-label="Darjeeling Stores home">
          <span className="brand-mark">
            <Icon name="shopping-bag" size={18} color="var(--maroon)" />
          </span>
          <span>Darjeeling Stores</span>
        </Link>

        <button className="location-pill" onClick={() => setIsLocationModalOpen(true)}>
          <span className="location-text">
            <span className="header-headline">{headline}</span>
            <span className="header-address">
              <span>{address}</span>
              <Icon name="chevron-down" size={16} color="var(--yellow)" />
            </span>
          </span>
        </button>

        <form onSubmit={handleSearchSubmit} className="header-search">
          <div className="search-icon-pos">
            <Icon name="search" size={20} />
          </div>
          <input
            type="text"
            className="search-input"
            placeholder={`Search "${HINTS[hintIndex]}"`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search products"
          />
        </form>

        <div className="header-actions">
          <Link href="/notifications" className="header-circle header-circle-ghost" title="Updates" onClick={(e) => goAccount(e, "/notifications")}>
            <Icon name="bell" size={19} color="#ffffff" />
          </Link>
          {signedIn ? (
            <Link href="/account" className="header-circle" title="My account">
              <Icon name="user" size={20} color="var(--maroon)" />
            </Link>
          ) : (
            <button className="header-circle" title="Sign in" onClick={() => setIsLoginModalOpen(true)}>
              <Icon name="user" size={20} color="var(--maroon)" />
            </button>
          )}
          <button className="cart-header-btn desktop-only" onClick={() => setIsCartDrawerOpen(true)}>
            <Icon name="shopping-bag" size={18} color="var(--maroon)" />
            <span>Cart</span>
            {count > 0 && <span className="cart-count-badge">{count}</span>}
          </button>
        </div>
      </div>
    </header>
  );
};
