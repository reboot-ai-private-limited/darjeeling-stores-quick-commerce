"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { rupees } from "../../lib/theme";
import { useStore } from "../../state/StoreContext";
import type { Product, Variant } from "../../lib/types";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

interface AddButtonProps {
  product: Product;
  variant?: Variant | undefined;
  /** On a product card: when the product has several sizes, show "ADD / N options" and open a sheet with a card per size. */
  withOptions?: boolean;
}

/** ADD, or a − n + stepper once the size is in the cart. */
const SizeControl: React.FC<{ product: Product; v: Variant; soldOut: boolean }> = ({ product, v, soldOut }) => {
  const { qtyOf, add, inc, remove } = useStore();
  const qty = qtyOf(v.variantId);
  if (soldOut) return <span className="sold-chip">Sold out</span>;
  if (qty === 0) {
    return (
      <button className="add-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); add(product, v); }}>
        ADD
      </button>
    );
  }
  return (
    <div className="stepper" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button className="stepper-btn" onClick={() => remove(v.variantId)} title="Decrease quantity">
        <Icon name="minus" size={14} color="#ffffff" />
      </button>
      <span className="stepper-qty">{qty}</span>
      <button className="stepper-btn" disabled={qty >= v.maxQty} onClick={() => inc(v.variantId)} title="Increase quantity">
        <Icon name="plus" size={14} color="#ffffff" />
      </button>
    </div>
  );
};

/** Every size of a product as its own card, with its price and an ADD button (the sheet that opens from "N options"). */
const OptionsSheet: React.FC<{ product: Product; isOpen: boolean; onClose: () => void }> = ({ product, isOpen, onClose }) => {
  const img = product.images?.[0]?.url;
  const notSold = product.availability !== "in_stock";
  return createPortal(
    <Modal isOpen={isOpen} onClose={onClose} title={product.name}>
      <p className="opt-sub">{product.variants.length} options</p>
      <div className="opt-list">
        {product.variants.map((v) => (
          <div key={v.variantId} className={`opt-card${!v.available ? " is-out" : ""}`}>
            <div className="opt-img">{img ? <img src={img} alt="" /> : <Icon name="package" size={26} color="var(--faint)" />}</div>
            <div className="opt-info">
              <div className="opt-label">{v.label}</div>
              <div className="opt-price-row">
                <span className="opt-price">{rupees(v.price)}</span>
                {v.mrp > v.price && <span className="opt-mrp">{rupees(v.mrp)}</span>}
              </div>
              {v.discountPercent > 0 && <div className="opt-off">{v.discountPercent}% OFF</div>}
            </div>
            <SizeControl product={product} v={v} soldOut={!v.available || notSold} />
          </div>
        ))}
      </div>
      <button className="opt-done" onClick={onClose}>Done</button>
    </Modal>,
    document.body,
  );
};

export const AddButton: React.FC<AddButtonProps> = ({ product, variant, withOptions }) => {
  const { qtyOf, add, inc, remove } = useStore();
  const [open, setOpen] = useState(false);
  const v = variant ?? product.variants?.[0];

  if (!v) return null;

  const qty = qtyOf(v.variantId);
  const outOfStock = !v.available || product.availability !== "in_stock";

  if (outOfStock && !(withOptions && product.variants.length > 1 && product.variants.some((x) => x.available) && product.availability === "in_stock")) {
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

  if (withOptions && product.variants.length > 1) {
    const total = product.variants.reduce((n, x) => n + qtyOf(x.variantId), 0);
    const opener = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setOpen(true); };
    return (
      <>
        {total === 0 ? (
          <button className="add-btn add-btn-opts" onClick={opener}>
            <span>ADD</span>
            <small>{product.variants.length} options</small>
          </button>
        ) : (
          <button className="stepper stepper-opts" onClick={opener} title="Choose sizes">
            <Icon name="minus" size={13} color="#ffffff" />
            <span className="stepper-qty">{total}</span>
            <Icon name="plus" size={13} color="#ffffff" />
          </button>
        )}
        {open && <OptionsSheet product={product} isOpen={open} onClose={() => setOpen(false)} />}
      </>
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
