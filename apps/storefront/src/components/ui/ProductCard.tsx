"use client";

import React from "react";
import Link from "next/link";
import { rupees } from "../../lib/theme";
import type { Product } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { AddButton } from "./AddButton";
import { Icon } from "./Icon";

interface ProductCardProps {
  product: Product;
  eta?: string;
}

/** Same card as the app: bordered picture with a corner discount tag, the ADD button overlapping the picture's bottom edge, ETA pill, name, size and price. */
export const ProductCard: React.FC<ProductCardProps> = ({ product, eta }) => {
  const { storeStatus } = useStore();
  const v = product.variants?.find((x) => x.available) ?? product.variants?.[0];
  const img = product.images?.[0]?.url;
  const out = product.availability !== "in_stock";
  const etaText = eta ?? (storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} min` : "");

  return (
    <div className={`product-card${out ? " is-out" : ""}`}>
      <Link href={`/product/${product.id}`} style={{ display: "block" }}>
        <div className="product-img-wrap">
          {img ? (
            <img src={img} alt={product.name} className="product-img" loading="lazy" />
          ) : (
            <Icon name="package" size={32} color="var(--faint)" />
          )}
          {v && v.discountPercent > 0 && <span className="discount-badge">{v.discountPercent}% OFF</span>}
        </div>
      </Link>
      <div className="card-add-pos">
        {out ? (
          <span className="sold-chip">{product.availability === "closed" ? "Closed" : "Sold out"}</span>
        ) : (
          <AddButton product={product} variant={v} />
        )}
      </div>

      <Link href={`/product/${product.id}`} className="product-meta" style={{ display: "block", minWidth: 0 }}>
        {etaText ? (
          <div className="product-eta-chip">
            <Icon name="clock" size={10} color="var(--muted)" />
            <span>{etaText.toUpperCase()}</span>
          </div>
        ) : (
          <div style={{ height: 8 }} />
        )}
        <h3 className="product-title" title={product.name}>
          {product.name}
        </h3>
        <p className="product-variant-label">{v?.label ?? ""}</p>
        <div className="product-price-row">
          <span className="product-price">{v ? rupees(v.price) : ""}</span>
          {v && v.mrp > v.price && <span className="product-mrp">{rupees(v.mrp)}</span>}
        </div>
      </Link>
    </div>
  );
};
