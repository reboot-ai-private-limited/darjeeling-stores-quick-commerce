import React from "react";

export const ProductCardSkeleton: React.FC = () => (
  <div className="product-card" style={{ gap: 10 }}>
    <div className="skeleton" style={{ width: "100%", height: 124, borderRadius: 16 }} />
    <div className="skeleton" style={{ width: "40%", height: 14 }} />
    <div className="skeleton" style={{ width: "80%", height: 18 }} />
    <div className="skeleton" style={{ width: "50%", height: 14 }} />
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 8,
      }}
    >
      <div className="skeleton" style={{ width: 60, height: 22 }} />
      <div className="skeleton" style={{ width: 70, height: 32, borderRadius: 10 }} />
    </div>
  </div>
);

export const HomeSkeleton: React.FC = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 32, padding: "20px 0" }}>
    {/* Banner skeleton */}
    <div className="skeleton" style={{ width: "100%", height: 200, borderRadius: 8 }} />

    {/* Categories skeleton */}
    <div>
      <div className="skeleton" style={{ width: 180, height: 24, marginBottom: 16 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 12 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div className="skeleton" style={{ width: 64, height: 64, borderRadius: "50%" }} />
            <div className="skeleton" style={{ width: 50, height: 12 }} />
          </div>
        ))}
      </div>
    </div>

    {/* Product rails skeleton */}
    <div>
      <div className="skeleton" style={{ width: 160, height: 24, marginBottom: 16 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  </div>
);
