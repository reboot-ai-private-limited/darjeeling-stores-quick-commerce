"use client";

import React from "react";
import Link from "next/link";
import { useStore } from "../../../state/StoreContext";
import { ProductCard } from "../../../components/ui/ProductCard";
import { Icon } from "../../../components/ui/Icon";

export default function FavouritesPage() {
  const { storeStatus, favouriteProducts } = useStore();
  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} mins` : "10-15 mins";

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/account" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <div>
          <h1 className="title" style={{ fontSize: 22 }}>My Favourites</h1>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {favouriteProducts.length} {favouriteProducts.length === 1 ? "item" : "items"} saved
          </span>
        </div>
      </div>

      {favouriteProducts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 16px" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--red-soft)",
              color: "var(--red)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Icon name="heart" size={32} color="var(--red)" />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--maroon)" }}>No favourites saved yet</h3>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4, marginBottom: 20 }}>
            Tap the heart icon on any product to save it here for quick reordering anytime.
          </p>
          <Link href="/" className="btn btn-primary">
            Explore Products
          </Link>
        </div>
      ) : (
        <div className="product-grid">
          {favouriteProducts.map((p) => (
            <ProductCard key={p.id} product={p} eta={eta} />
          ))}
        </div>
      )}
    </main>
  );
}
