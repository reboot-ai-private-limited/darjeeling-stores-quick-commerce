"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Banner } from "../../lib/types";
import { useDragScroll } from "../ui/HScroll";

interface BannerCarouselProps {
  banners: Banner[];
  eta?: string;
}

const hrefOf = (b: Banner): string | null => {
  if (!b.linkValue) return null;
  if (b.linkType === "category") return `/category/${b.linkValue}`;
  return b.linkValue;
};

/** Picture-only promo banners (no overlaid text). Two sit side by side on wider screens; the strip auto-advances until touched. */
export const BannerCarousel: React.FC<BannerCarouselProps> = ({ banners }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [index, setIndex] = useState(0);
  useDragScroll(trackRef);

  const perView = () => (typeof window !== "undefined" && window.innerWidth >= 640 ? 2 : 1);
  const lastStart = useCallback(() => Math.max(0, banners.length - perView()), [banners.length]);

  const goTo = useCallback((i: number) => {
    const el = trackRef.current;
    const slide = el?.children[i] as HTMLElement | undefined;
    if (!el || !slide) return;
    el.scrollTo({ left: slide.offsetLeft - el.offsetLeft, behavior: "smooth" });
    setIndex(i);
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => {
      if (touched.current) return;
      const max = lastStart();
      if (max === 0) return;
      goTo(index >= max ? 0 : index + 1);
    }, 4000);
    return () => clearInterval(t);
  }, [banners.length, index, lastStart, goTo]);

  if (!banners || banners.length === 0) return null;

  const single = banners.length === 1;
  const dots = Math.max(1, banners.length - perView() + 1);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={trackRef}
        className="banner-track"
        onPointerDown={() => (touched.current = true)}
        onScroll={(e) => {
          const el = e.currentTarget;
          const first = el.children[0] as HTMLElement | undefined;
          if (first) setIndex(Math.round(el.scrollLeft / (first.offsetWidth + 12)));
        }}
      >
        {banners.map((b) => {
          const href = hrefOf(b);
          const img = (
            <div className="banner-slide-img" style={{ background: "var(--yellow)" }}>
              {b.imageUrl ? (
                <img src={b.imageUrl} alt={b.title} draggable={false} />
              ) : (
                <span style={{ color: "var(--maroon)", fontWeight: 900, fontSize: 22, padding: 20, alignSelf: "flex-end" }}>{b.title}</span>
              )}
            </div>
          );
          return (
            <div key={b.id} className={`banner-slide${single ? " single" : ""}`}>
              {href ? (
                href.startsWith("http") ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {img}
                  </a>
                ) : (
                  <Link href={href}>{img}</Link>
                )
              ) : (
                img
              )}
            </div>
          );
        })}
      </div>

      {dots > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
          {Array.from({ length: dots }).map((_, i) => (
            <button
              key={i}
              aria-label={`Banner ${i + 1}`}
              onClick={() => {
                touched.current = true;
                goTo(i);
              }}
              style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 3, background: i === index ? "var(--maroon)" : "var(--line)", transition: "all .2s" }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
