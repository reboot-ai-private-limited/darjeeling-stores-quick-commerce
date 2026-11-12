"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCategoryProducts, getProduct, submitNotifyMe } from "../../../lib/api";
import { rupees } from "../../../lib/theme";
import type { Product, Variant } from "../../../lib/types";
import { useStore } from "../../../state/StoreContext";
import { ProductCard } from "../../../components/ui/ProductCard";
import { HScroll } from "../../../components/ui/HScroll";
import { Icon } from "../../../components/ui/Icon";

/** Add to cart button that turns into a quantity stepper once the item is in the cart. */
function CartControl({ product, variant }: { product: Product; variant: Variant }) {
  const { qtyOf, add, inc, remove, setIsCartDrawerOpen } = useStore();
  const qty = qtyOf(variant.variantId);

  if (qty === 0) {
    return (
      <button className="pd-add" onClick={() => add(product, variant)}>
        Add to cart
      </button>
    );
  }
  return (
    <div className="pd-incart">
      <div className="pd-stepper">
        <button onClick={() => remove(variant.variantId)} aria-label="Remove one">
          <Icon name="minus" size={18} color="#fff" />
        </button>
        <span>{qty}</span>
        <button onClick={() => inc(variant.variantId)} disabled={qty >= variant.maxQty} aria-label="Add one more">
          <Icon name="plus" size={18} color="#fff" />
        </button>
      </div>
      <button className="pd-gocart" onClick={() => setIsCartDrawerOpen(true)}>
        View cart
      </button>
    </div>
  );
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = use(params);
  const { zone, storeStatus, isFavourite, toggleFavourite, signedIn, setIsLoginModalOpen } = useStore();

  const [product, setProduct] = useState<Product | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [related, setRelated] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const share = async () => {
    if (!product) return;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: product.name, text: `${product.name} on Darjeeling Stores`, url });
      } catch {
        /* the share sheet was closed */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch {
      showToast("Couldn't copy the link");
    }
  };

  useEffect(() => {
    setLoading(true);
    setImageIndex(0);
    getProduct(productId, zone?.id)
      .then((prod) => {
        setProduct(prod);
        setVariantId((prod.variants.find((x) => x.available) ?? prod.variants[0])?.variantId ?? null);
        if (zone && prod.category?.id) {
          getCategoryProducts(zone.id, prod.category.id)
            .then((rel) => setRelated(rel.filter((p) => p.id !== prod.id).slice(0, 12)))
            .catch(() => setRelated([]));
        }
      })
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [productId, zone]);

  const v = useMemo(() => product?.variants.find((x) => x.variantId === variantId) ?? product?.variants[0], [product, variantId]);

  const notify = async () => {
    if (!product) return;
    if (!signedIn) {
      setIsLoginModalOpen(true);
      return;
    }
    try {
      await submitNotifyMe(zone?.id ?? "", product.id, variantId ?? undefined);
      setNote("We will tell you when it is back.");
    } catch {
      setNote("Couldn't save that. Try again.");
    }
  };

  if (loading) {
    return (
      <main className="page-container pd-wrap">
        <div className="pd-grid">
          <div className="skeleton" style={{ aspectRatio: "1", borderRadius: 20 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="skeleton" style={{ height: 34, width: "70%" }} />
            <div className="skeleton" style={{ height: 44, width: "40%" }} />
            <div className="skeleton" style={{ height: 52 }} />
          </div>
        </div>
      </main>
    );
  }

  if (!product || !v) {
    return (
      <main className="page-container" style={{ textAlign: "center", padding: "80px 16px" }}>
        <h2 className="title">This item isn&apos;t available in your area</h2>
        <Link href="/" className="btn btn-primary" style={{ marginTop: 18 }}>
          Back to home
        </Link>
      </main>
    );
  }

  const images = product.images.filter((i) => i.url);
  const current = images[imageIndex]?.url;
  const isFav = isFavourite(product.id);
  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} min` : "";
  const soldOut = product.availability !== "in_stock" || !v.available;
  const rows: { label: string; value: string }[] = [
    { label: "Pack size", value: v.label },
    ...(product.keyInfo ?? []).map((k) => ({ label: k.label, value: k.value })),
    ...(product.nutrition ?? []).map((n) => ({ label: n.label, value: n.value })),
  ];

  return (
    <main className="page-container pd-wrap">
      <div className="pd-grid">
        <section className="pd-gallery">
          <div className="pd-stage">
            {current ? <img src={current} alt={product.name} className="pd-img" draggable={false} /> : <Icon name="package" size={64} color="var(--faint)" />}
            {v.discountPercent > 0 && <span className="pd-off">{v.discountPercent}% OFF</span>}
            <div className="pd-actions">
              <button className="pd-circle" onClick={() => toggleFavourite(product)} aria-label={isFav ? "Remove from favourites" : "Save to favourites"}>
                <Icon name="heart" size={19} color={isFav ? "var(--red)" : "var(--ink)"} className={isFav ? "fill-current" : ""} />
              </button>
              <button className="pd-circle" onClick={() => void share()} aria-label="Share">
                <Icon name="share-2" size={19} color="var(--ink)" />
              </button>
            </div>
          </div>
          {images.length > 1 && (
            <div className="pd-thumbs">
              {images.map((img, idx) => (
                <button key={img.id} className={`pd-thumb${idx === imageIndex ? " on" : ""}`} onClick={() => setImageIndex(idx)} aria-label={`Photo ${idx + 1}`}>
                  <img src={img.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pd-info">
          {product.brand && <span className="pd-brand">{product.brand}</span>}
          <h1 className="pd-title">{product.name}</h1>
          {eta && <span className="pd-eta">Delivery in {eta}</span>}

          <div className="pd-price">
            <span className="pd-now">{rupees(v.price)}</span>
            {v.mrp > v.price && <span className="pd-mrp">{rupees(v.mrp)}</span>}
            {v.mrp > v.price && <span className="pd-save">Save {rupees(v.mrp - v.price)}</span>}
          </div>

          {product.variants.length > 1 && (
            <div className="pd-variants">
              {product.variants.map((x) => (
                <button
                  key={x.variantId}
                  className={`pd-variant${x.variantId === v.variantId ? " on" : ""}${x.available ? "" : " off"}`}
                  onClick={() => setVariantId(x.variantId)}
                  aria-pressed={x.variantId === v.variantId}
                >
                  <span className="pd-variant-label">{x.label}</span>
                  <span className="pd-variant-price">
                    {rupees(x.price)}
                    {x.mrp > x.price && <s>{rupees(x.mrp)}</s>}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="pd-cta-inline">
            {soldOut ? (
              <div className="pd-notify">
                <span className="pd-soldtext">Sold out in your area</span>
                <button className="pd-add" onClick={() => void notify()} disabled={!!note}>
                  {note ? "You're on the list" : "Notify me when it's back"}
                </button>
                {note && <span className="small">{note}</span>}
              </div>
            ) : (
              <CartControl product={product} variant={v} />
            )}
          </div>

          {(product.description || rows.length > 0 || product.sections?.length) && (
            <div className="pd-details">
              {product.description && (
                <>
                  <h2 className="pd-h">About</h2>
                  <p className="pd-desc">{product.description}</p>
                </>
              )}
              {rows.length > 0 && (
                <dl className="pd-dl">
                  {rows.map((r) => (
                    <div key={r.label}>
                      <dt>{r.label}</dt>
                      <dd>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {product.sections?.map((sec) => (
                <div key={sec.title}>
                  <h2 className="pd-h">{sec.title}</h2>
                  <p className="pd-desc">{sec.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {related.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <h2 className="sec-title" style={{ marginBottom: 6 }}>
            You may also like
          </h2>
          <HScroll className="rail">
            {related.map((p) => (
              <div key={p.id} className="rail-item">
                <ProductCard product={p} eta={eta} />
              </div>
            ))}
          </HScroll>
        </section>
      )}

      {toast && <div className="pd-toast">{toast}</div>}

      {/* Pinned buy bar on phones */}
      <div className="pd-bar">
        <div className="pd-bar-price">
          <b>{rupees(v.price)}</b>
          <small>{v.label}</small>
        </div>
        <div className="pd-bar-cta">
          {soldOut ? (
            <button className="pd-add" onClick={() => void notify()} disabled={!!note}>
              {note ? "On the list" : "Notify me"}
            </button>
          ) : (
            <CartControl product={product} variant={v} />
          )}
        </div>
      </div>
    </main>
  );
}
