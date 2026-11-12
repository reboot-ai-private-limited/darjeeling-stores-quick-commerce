"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { getCategories, getCategoryProducts } from "../../../lib/api";
import type { Category, Product } from "../../../lib/types";
import { useStore } from "../../../state/StoreContext";
import { ProductCard } from "../../../components/ui/ProductCard";
import { ProductCardSkeleton } from "../../../components/ui/Skeleton";
import { Icon } from "../../../components/ui/Icon";

export default function CategoryProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: categoryId } = use(params);
  const { zone, storeStatus } = useStore();

  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [subCategoryId, setSubCategoryId] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<string>("relevance");
  const [vegOnly, setVegOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load category details
  useEffect(() => {
    if (!zone) return;
    getCategories(zone.id)
      .then((cats) => {
        const found = cats.find((c) => c.id === categoryId);
        if (found) setCategory(found);
      })
      .catch(() => undefined);
  }, [zone, categoryId]);

  // Load category products
  useEffect(() => {
    if (!zone) return;
    setLoading(true);
    getCategoryProducts(zone.id, categoryId, subCategoryId, sort)
      .then((res) => setProducts(res))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [zone, categoryId, subCategoryId, sort]);

  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} mins` : "10-15 mins";

  const filteredProducts = products.filter((p) => {
    if (vegOnly && p.foodType !== "veg") return false;
    if (inStockOnly && p.availability !== "in_stock") return false;
    return true;
  });

  return (
    <main className="page-container" style={{ padding: "16px 16px 40px" }}>
      {/* Top Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Link href="/" style={{ color: "var(--maroon)", display: "flex" }}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <div>
          <h1 className="title" style={{ fontSize: 20 }}>
            {category?.name ?? "Category Products"}
          </h1>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {filteredProducts.length} {filteredProducts.length === 1 ? "product" : "products"}
          </span>
        </div>
      </div>

      {/* Subcategory Chips */}
      {category?.subcategories && category.subcategories.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 10,
            marginBottom: 12,
            scrollbarWidth: "none",
          }}
        >
          <button
            onClick={() => setSubCategoryId(undefined)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
              border: `1.5px solid ${!subCategoryId ? "var(--maroon)" : "var(--line)"}`,
              background: !subCategoryId ? "var(--maroon)" : "var(--card)",
              color: !subCategoryId ? "var(--white)" : "var(--ink)",
              cursor: "pointer",
            }}
          >
            All
          </button>
          {category.subcategories.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setSubCategoryId(sub.id)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: "nowrap",
                border: `1.5px solid ${subCategoryId === sub.id ? "var(--maroon)" : "var(--line)"}`,
                background: subCategoryId === sub.id ? "var(--maroon)" : "var(--card)",
                color: subCategoryId === sub.id ? "var(--white)" : "var(--ink)",
                cursor: "pointer",
              }}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* Filter and Sort Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          padding: "10px 0",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setVegOnly(!vegOnly)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 8,
              border: `1px solid ${vegOnly ? "var(--green)" : "var(--line)"}`,
              background: vegOnly ? "var(--green-soft)" : "var(--card)",
              color: vegOnly ? "var(--green)" : "var(--ink)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <div className="food-badge veg" style={{ position: "static" }} />
            <span>Veg only</span>
          </button>

          <button
            onClick={() => setInStockOnly(!inStockOnly)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 8,
              border: `1px solid ${inStockOnly ? "var(--maroon)" : "var(--line)"}`,
              background: inStockOnly ? "var(--yellow-soft)" : "var(--card)",
              color: inStockOnly ? "var(--maroon)" : "var(--ink)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span>In stock</span>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Sort by:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              padding: "5px 10px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--card)",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--ink)",
              outline: "none",
            }}
          >
            <option value="relevance">Relevance</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="discount">Biggest Discount</option>
          </select>
        </div>
      </div>

      {/* Products Grid */}
      {loading ? (
        <div className="product-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredProducts.length > 0 ? (
        <div className="product-grid">
          {filteredProducts.map((p) => (
            <ProductCard key={p.id} product={p} eta={eta} />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p style={{ color: "var(--muted)", fontSize: 15 }}>No matching products found in this category.</p>
        </div>
      )}
    </main>
  );
}
