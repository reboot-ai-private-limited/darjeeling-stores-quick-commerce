"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { getBrands, searchCatalog } from "../../../lib/api";
import type { BrandInfo, Product } from "../../../lib/types";
import { useStore } from "../../../state/StoreContext";
import { ProductCard } from "../../../components/ui/ProductCard";
import { ProductCardSkeleton } from "../../../components/ui/Skeleton";
import { Icon } from "../../../components/ui/Icon";

export default function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = use(params);
  const { zone, storeStatus } = useStore();

  const [brand, setBrand] = useState<BrandInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!zone) return;
    setLoading(true);

    getBrands(zone.id)
      .then(async (brands) => {
        const found = brands.find((b) => b.id === brandId);
        if (found) {
          setBrand(found);
          const results = await searchCatalog(zone.id, found.name);
          setProducts(results.filter((p) => p.brand?.toLowerCase() === found.name.toLowerCase()));
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [zone, brandId]);

  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} mins` : "10-15 mins";

  return (
    <main className="page-container" style={{ padding: "16px 16px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <div>
          <h1 className="title" style={{ fontSize: 20 }}>{brand?.name ?? "Brand Products"}</h1>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {products.length} {products.length === 1 ? "product" : "products"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="product-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : products.length > 0 ? (
        <div className="product-grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} eta={eta} />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p style={{ color: "var(--muted)" }}>No products found for this brand.</p>
        </div>
      )}
    </main>
  );
}
