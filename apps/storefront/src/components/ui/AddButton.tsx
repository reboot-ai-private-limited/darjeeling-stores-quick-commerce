"use client";

import React from "react";
import { useStore } from "../../state/StoreContext";
import type { Product, Variant } from "../../lib/types";
import { Icon } from "./Icon";

interface AddButtonProps {
  product: Product;
  variant?: Variant | undefined;
}

export const AddButton: React.FC<AddButtonProps> = ({ product, variant }) => {
  const { qtyOf, add, inc, remove } = useStore();
  const v = variant ?? product.variants?.[0];

  if (!v) return null;

  const qty = qtyOf(v.variantId);
  const outOfStock = !v.available || product.availability !== "in_stock";

  if (outOfStock) {
    return (
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--red)",
          background: "var(--red-soft)",
          padding: "4px 10px",
          borderRadius: 6,
        }}
      >
        Sold Out
      </span>
    );
  }

  if (qty === 0) {
    return (
      <button
        className="add-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          add(product, v);
        }}
      >
        ADD
      </button>
    );
  }

  return (
    <div
      className="stepper"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        className="stepper-btn"
        onClick={() => remove(v.variantId)}
        title="Decrease quantity"
      >
        <Icon name="minus" size={14} color="#ffffff" />
      </button>
      <span className="stepper-qty">{qty}</span>
      <button
        className="stepper-btn"
        disabled={qty >= v.maxQty}
        onClick={() => inc(v.variantId)}
        title="Increase quantity"
      >
        <Icon name="plus" size={14} color="#ffffff" />
      </button>
    </div>
  );
};
