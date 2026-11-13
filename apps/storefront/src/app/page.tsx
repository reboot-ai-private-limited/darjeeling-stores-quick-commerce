"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getBrands, getHomeData } from "../lib/api";
import { CATEGORY_TINTS } from "../lib/theme";
import type { BrandInfo, Category, HomeData, Product } from "../lib/types";
import { useStore } from "../state/StoreContext";
import { BannerCarousel } from "../components/home/BannerCarousel";
import { LiveOrderCard } from "../components/home/LiveOrderCard";
import { OffersRow } from "../components/home/OffersRow";
import { OrderAgainCard } from "../components/home/OrderAgainCard";
import { CategoryTile } from "../components/ui/CategoryTile";
import { ProductCard } from "../components/ui/ProductCard";
import { HomeSkeleton } from "../components/ui/Skeleton";
import { Icon } from "../components/ui/Icon";
import { HScroll } from "../components/ui/HScroll";

const Rail: React.FC<{ title: string; subtitle?: string | null | undefined; icon?: boolean; href?: string | undefined; products: Product[]; eta: string }> = ({
  title,
  subtitle,
  icon,
  href,
  products,
  eta,
}) => (
  <section style={{ marginTop: 14 }}>
    <div className="sec-head">
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <Icon name="zap" size={20} color="var(--yellow)" />}
          <h2 className="sec-title">{title}</h2>
        </div>
        {subtitle && <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} style={{ fontSize: 13, fontWeight: 800, color: "var(--maroon)" }}>
          See all
        </Link>
      )}
    </div>
    <HScroll className="rail">
      {products.map((p) => (
        <div key={p.id} className="rail-item">
          <ProductCard product={p} eta={eta} />
        </div>
      ))}
    </HScroll>
  </section>
);

export default function HomePage() {
  const { zone, booting, setIsLocationModalOpen } = useStore();
  const [homeData, setHomeData] = useState<HomeData | null>(null);
  const [brands, setBrands] = useState<BrandInfo[]>([]);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!zone) return;
    setLoading(true);
    setError(null);
    Promise.all([getHomeData(zone.id), getBrands(zone.id).catch(() => [])])
      .then(([home, bList]) => {
        setHomeData(home);
        setBrands(bList);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load catalogue."))
      .finally(() => setLoading(false));
  }, [zone]);

  const allProducts = useMemo(() => {
    const out: Product[] = [];
    const seen = new Set<string>();
    for (const sec of homeData?.sections ?? []) {
      for (const p of sec.products) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push(p);
        }
      }
    }
    return out;
  }, [homeData]);

  /** A category's own picture, else the first product photo from its shelf (same as the app). */
  const pics = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of homeData?.categories ?? []) {
      if (c.imageUrl) continue;
      const img = allProducts.find((p) => p.category?.id === c.id && p.images?.[0]?.url)?.images?.[0]?.url;
      if (img) out[c.id] = img;
    }
    return out;
  }, [homeData, allProducts]);

  if (booting) {
    return (
      <main className="page-container" style={{ padding: "20px 16px" }}>
        <HomeSkeleton />
      </main>
    );
  }

  if (!zone) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "60px 16px" }}>
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
          <Icon name="map-pin" size={36} color="var(--maroon)" />
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--maroon)", marginBottom: 12 }}>Where should we deliver?</h1>
        <p style={{ color: "var(--muted)", fontSize: 16, maxWidth: 440, margin: "0 auto 24px" }}>
          Darjeeling Stores provides ultra-fast delivery of authentic tea and fresh groceries. Set your location to see what’s available in your zone.
        </p>
        <button className="btn btn-primary" onClick={() => setIsLocationModalOpen(true)} style={{ padding: "14px 28px", fontSize: 16 }}>
          Select Delivery Location
        </button>
      </main>
    );
  }

  const eta = homeData?.status ? `${homeData.status.etaMinMinutes}-${homeData.status.etaMaxMinutes} min` : "";

  const dealProducts = allProducts
    .filter((p) => (p.variants?.[0]?.discountPercent ?? 0) > 0 && p.availability === "in_stock")
    .sort((a, b) => (b.variants?.[0]?.discountPercent ?? 0) - (a.variants?.[0]?.discountPercent ?? 0))
    .slice(0, 10);
  const budgetProducts = allProducts.filter((p) => (p.variants?.[0]?.price ?? 99999) <= 9900 && p.availability === "in_stock").slice(0, 10);

  const activeCategory: Category | undefined = homeData?.categories.find((c) => c.id === selectedCategoryTab);
  const activeTabProducts = activeCategory ? allProducts.filter((p) => p.category?.id === activeCategory.id) : [];

  return (
    <main className="page-container" style={{ padding: "8px 16px 32px" }}>
      {homeData && !homeData.status.accepting && (
        <Link
          href="/closed"
          style={{
            background: "var(--amber-soft)",
            borderRadius: 16,
            padding: "12px 16px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon name="clock" size={18} color="var(--amber)" />
          <span style={{ flex: 1, fontSize: 13, color: "var(--ink)" }}>We're not taking orders right now. Tap to see when we open or pre-order.</span>
          <Icon name="chevron-right" size={16} color="var(--amber)" />
        </Link>
      )}

      {homeData?.notices?.map((n) => (
        <div
          key={n.label}
          style={{
            background: "var(--yellow-soft)",
            borderRadius: 16,
            padding: "10px 14px",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--ink)",
          }}
        >
          <Icon name="info" size={16} color="var(--amber)" />
          <span>{n.label}</span>
        </div>
      ))}

      {homeData && homeData.categories.length > 0 && (
        <HScroll className="cat-tabs">
          <button className={`cat-tab${selectedCategoryTab === null ? " active" : ""}`} onClick={() => setSelectedCategoryTab(null)}>
            <span className="cat-tab-pic" style={{ background: "var(--yellow-soft)" }}>
              <Icon name="home" size={22} color="var(--maroon)" />
            </span>
            All
          </button>
          {homeData.categories.map((c, i) => {
            const src = c.imageUrl || pics[c.id];
            return (
              <button key={c.id} className={`cat-tab${selectedCategoryTab === c.id ? " active" : ""}`} onClick={() => setSelectedCategoryTab(c.id)}>
                <span className="cat-tab-pic" style={{ background: CATEGORY_TINTS[i % CATEGORY_TINTS.length] }}>
                  {src ? <img src={src} alt="" /> : <Icon name="shopping-bag" size={20} color="var(--maroon)" />}
                </span>
                {c.name}
              </button>
            );
          })}
        </HScroll>
      )}

      {loading && !homeData && <HomeSkeleton />}

      {error && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Icon name="wifi-off" size={40} color="var(--faint)" />
          <p style={{ color: "var(--muted)", margin: "12px 0" }}>{error}</p>
          <button className="btn btn-soft" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      )}

      {selectedCategoryTab && activeCategory && (
        <div style={{ marginTop: 10 }}>
          <div className="sec-head" style={{ marginBottom: 16 }}>
            <h2 className="sec-title">{activeCategory.name}</h2>
            <Link href={`/category/${activeCategory.id}`} style={{ fontSize: 13, fontWeight: 800, color: "var(--maroon)" }}>
              View full category →
            </Link>
          </div>
          {activeTabProducts.length > 0 ? (
            <div className="product-grid">
              {activeTabProducts.map((p) => (
                <ProductCard key={p.id} product={p} eta={eta} />
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--muted)", padding: "20px 0" }}>No products found in this category for your zone.</p>
          )}
        </div>
      )}

      {!selectedCategoryTab && homeData && (
        <>
          <LiveOrderCard />

          <div style={{ marginTop: 10 }}>
            <BannerCarousel banners={homeData.banners} eta={eta} />
          </div>

          {homeData.categories.length > 0 && (
            <section style={{ marginTop: 14 }}>
              <h2 className="sec-title">Shop by category</h2>
              <div className="cat-grid" style={{ marginTop: 12 }}>
                {homeData.categories.map((c, i) => (
                  <CategoryTile key={c.id} category={c} tintIndex={i} picture={pics[c.id]} />
                ))}
              </div>
            </section>
          )}

          <OffersRow />
          <OrderAgainCard />

          {dealProducts.length > 0 && <Rail title="Crazy deals & discounts" icon products={dealProducts} eta={eta} />}
          {budgetProducts.length > 0 && <Rail title="Under ₹99" products={budgetProducts} eta={eta} />}

          {brands.length > 0 && (
            <section style={{ marginTop: 14 }}>
              <h2 className="sec-title" style={{ marginBottom: 12 }}>
                Shop by brand
              </h2>
              <HScroll className="rail" style={{ paddingBottom: 8 }}>
                {brands.map((b) => (
                  <Link key={b.id} href={`/brand/${b.id}`} style={{ width: 76, flexShrink: 0, textAlign: "center" }}>
                    <div
                      style={{
                        width: 76,
                        height: 76,
                        borderRadius: 8,
                        background: "var(--white)",
                        border: "1px solid var(--line)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {b.logoUrl ? (
                        <img src={b.logoUrl} alt={b.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : (
                        <Icon name="tag" size={22} color="var(--maroon)" />
                      )}
                    </div>
                    <span style={{ display: "block", marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--ink)", lineHeight: 1.2 }}>{b.name}</span>
                  </Link>
                ))}
              </HScroll>
            </section>
          )}

          {homeData.sections.map((sec) => (
            <Rail key={sec.id} title={sec.title} subtitle={sec.subtitle} href={sec.products[0]?.category?.id ? `/category/${sec.products[0].category.id}` : undefined} products={sec.products} eta={eta} />
          ))}

          {homeData.sections.length === 0 && homeData.categories.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--muted)", marginTop: 60 }}>This store has nothing on the shelves yet.</p>
          )}

        </>
      )}
    </main>
  );
}
