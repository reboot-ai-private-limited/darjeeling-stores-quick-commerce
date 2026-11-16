"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { getBrands, getProductsPage } from "../../../lib/api";
import { usePagedProducts } from "../../../lib/usePagedProducts";
import type { BrandInfo } from "../../../lib/types";
import { useStore } from "../../../state/StoreContext";
import { ProductCard } from "../../../components/ui/ProductCard";
import { ProductCardSkeleton } from "../../../components/ui/Skeleton";
import { Icon } from "../../../components/ui/Icon";

export default function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = use(params);
  const { zone, storeStatus } = useStore();

  const [brand, setBrand] = useState<BrandInfo | null>(null);
  useEffect(() => {
    if (!zone) return;
    getBrands(zone.id)
      .then((brands) => { const found = brands.find((b) => b.id === brandId); if (found) setBrand(found); })
      .catch(() => undefined);
  }, [zone, brandId]);

  // The brand's products load 10 at a time as the page is scrolled.
  const { items: products, loading, loadingMore, hasMore, failed, retry, sentinelRef } = usePagedProducts(
    (cursor) => getProductsPage({ zoneId: zone!.id, brandId, cursor }),
    !!zone,
    [zone?.id, brandId],
  );

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
            {brand ? brand.productCount : products.length} {(brand ? brand.productCount : products.length) === 1 ? "product" : "products"}
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
        <>
          <div className="product-grid">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} eta={eta} />
            ))}
            {loadingMore && Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={`more${i}`} />)}
          </div>
          {failed && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 8 }}>Couldn&apos;t load more products.</p>
              <button onClick={retry} style={{ fontWeight: 700, color: "var(--maroon)", cursor: "pointer" }}>Try again</button>
            </div>
          )}
          {hasMore && <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />}
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p style={{ color: "var(--muted)" }}>No products found for this brand.</p>
        </div>
      )}
    </main>
  );
}
