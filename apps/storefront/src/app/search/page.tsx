"use client";

import React, { useEffect, useState, useTransition, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { searchCatalog } from "../../lib/api";
import { storage } from "../../lib/storage";
import type { Product } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { ProductCard } from "../../components/ui/ProductCard";
import { ProductCardSkeleton } from "../../components/ui/Skeleton";
import { Icon } from "../../components/ui/Icon";

export const dynamic = "force-dynamic";

const RECENT_KEY = "darjeeling.recent_searches";
const POPULAR_SEARCHES = ["Darjeeling First Flush", "Chhurpi", "Hill Spices", "Green Tea", "Cardamom", "Wai Wai"];

function SearchContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const { zone, storeStatus } = useStore();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Product[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    setRecentSearches(storage.getJSON<string[]>(RECENT_KEY, []));
  }, []);

  const executeSearch = (searchTerm: string) => {
    if (!zone || !searchTerm.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    searchCatalog(zone.id, searchTerm.trim())
      .then((res) => {
        setResults(res);
        // Save to recent searches
        setRecentSearches((prev) => {
          const updated = [searchTerm.trim(), ...prev.filter((s) => s.toLowerCase() !== searchTerm.trim().toLowerCase())].slice(0, 6);
          storage.setJSON(RECENT_KEY, updated);
          return updated;
        });
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      executeSearch(initialQuery);
    }
  }, [initialQuery, zone]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(query);
  };

  const handleClearRecent = () => {
    setRecentSearches([]);
    storage.remove(RECENT_KEY);
  };

  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} mins` : "10-15 mins";

  return (
    <main className="page-container" style={{ padding: "16px 16px 40px" }}>
      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} style={{ position: "relative", marginBottom: 20 }}>
        <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}>
          <Icon name="search" size={18} />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) setResults([]);
          }}
          placeholder="Search tea, biscuits, snacks, spices..."
          style={{
            width: "100%",
            padding: "14px 16px 14px 46px",
            borderRadius: 9999,
            border: "1.5px solid var(--maroon)",
            background: "var(--card)",
            fontSize: 15,
            fontWeight: 600,
            outline: "none",
          }}
          autoFocus
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
            }}
            style={{
              position: "absolute",
              right: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              padding: 4,
            }}
          >
            <Icon name="x" size={18} />
          </button>
        )}
      </form>

      {/* When no active search, show Recent & Popular suggestions */}
      {!query && results.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {recentSearches.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                  Recent Searches
                </span>
                <button onClick={handleClearRecent} style={{ fontSize: 12, color: "var(--maroon)", fontWeight: 700 }}>
                  Clear all
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {recentSearches.map((term) => (
                  <button
                    key={term}
                    onClick={() => {
                      setQuery(term);
                      executeSearch(term);
                    }}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 9999,
                      background: "var(--cream-deep)",
                      color: "var(--ink)",
                      fontSize: 13,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Icon name="clock" size={13} color="var(--muted)" />
                    <span>{term}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 12 }}>
              Popular Searches
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {POPULAR_SEARCHES.map((term) => (
                <button
                  key={term}
                  onClick={() => {
                    setQuery(term);
                    executeSearch(term);
                  }}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 9999,
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    color: "var(--maroon)",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="product-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Results Grid */}
      {!loading && results.length > 0 && (
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 14 }}>
            Found {results.length} results for &ldquo;{query}&rdquo;
          </span>
          <div className="product-grid">
            {results.map((p) => (
              <ProductCard key={p.id} product={p} eta={eta} />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && query && results.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 16px" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--yellow-soft)",
              color: "var(--maroon)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Icon name="search" size={28} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--maroon)", marginBottom: 8 }}>
            No products found for &ldquo;{query}&rdquo;
          </h3>
          <p style={{ color: "var(--muted)", fontSize: 14, maxWidth: 360, margin: "0 auto 20px" }}>
            Check for typos or try searching with generic terms like &ldquo;tea&rdquo;, &ldquo;butter&rdquo; or &ldquo;spices&rdquo;.
          </p>

          <div
            style={{
              maxWidth: 400,
              margin: "0 auto",
              padding: "16px 20px",
              background: "var(--card)",
              borderRadius: 16,
              border: "1px solid var(--line)",
              textAlign: "left",
            }}
          >
            <h4 style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>Can’t find what you need?</h4>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, marginBottom: 12 }}>
              Tell the store manager and we’ll try to stock it for you.
            </p>
            <button
              className="btn btn-outline"
              disabled={requested}
              onClick={() => setRequested(true)}
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              {requested ? "Request noted!" : "Request this product"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="page-container"><ProductCardSkeleton /></div>}>
      <SearchContent />
    </Suspense>
  );
}
