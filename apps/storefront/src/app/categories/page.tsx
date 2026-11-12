"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getCategories } from "../../lib/api";
import type { Category } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { CategoryTile } from "../../components/ui/CategoryTile";
import { Icon } from "../../components/ui/Icon";

export default function CategoriesPage() {
  const { zone, booting } = useStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!zone) return;
    setLoading(true);
    getCategories(zone.id)
      .then((res) => setCategories(res))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [zone]);

  return (
    <main className="page-container" style={{ padding: "20px 16px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1 className="title" style={{ fontSize: 22 }}>All Categories</h1>
      </div>

      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 16 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 110, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {!loading && categories.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
            gap: 16,
          }}
        >
          {categories.map((c, i) => (
            <CategoryTile key={c.id} category={c} tintIndex={i} />
          ))}
        </div>
      )}

      {!loading && categories.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p style={{ color: "var(--muted)" }}>No categories available for your current zone.</p>
        </div>
      )}
    </main>
  );
}
