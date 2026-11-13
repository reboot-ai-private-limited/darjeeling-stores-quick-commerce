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

/**
 * Picture-only promo banners (no overlaid text). Two sit side by side on wider screens.
 * The strip loops forever: it holds three copies of the banners and quietly jumps back to the middle copy whenever it nears either end,
 * so it can be swiped (or auto-advance) in the same direction without ever reaching a last banner.
 */
export const BannerCarousel: React.FC<BannerCarouselProps> = ({ banners }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const lastTouch = useRef(0);
  const [index, setIndex] = useState(0);
  useDragScroll(trackRef);

  const n = banners.length;
  const loop = n > 1;
  const copies = loop ? 3 : 1;

  /** The distance from one banner to the next, and the width of one full copy of the banners. */
  const measure = useCallback(() => {
    const el = trackRef.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return null;
    const step = first.offsetWidth + 12;
    return { el, step, setWidth: step * n };
  }, [n]);

  const jump = useCallback((el: HTMLElement, left: number) => {
    // Scroll snapping would fight an instant jump, so it is paused for that moment.
    el.style.scrollSnapType = "none";
    el.style.scrollBehavior = "auto";
    el.scrollLeft = left;
    requestAnimationFrame(() => {
      el.style.scrollSnapType = "";
      el.style.scrollBehavior = "";
    });
  }, []);

  // Start on the middle copy, and keep there if the window is resized.
  useEffect(() => {
    if (!loop) return;
    const place = () => {
      const m = measure();
      if (m) jump(m.el, m.setWidth + (m.el.scrollLeft % m.step));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [loop, measure, jump, banners]);

  // After a swipe settles near the first or last copy, move to the same picture in the middle copy.
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onScroll = () => {
    const m = measure();
    if (!m) return;
    const { el, step, setWidth } = m;
    const pos = Math.round((el.scrollLeft - (loop ? setWidth : 0)) / step);
    setIndex(((pos % n) + n) % n);
    if (!loop) return;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (el.scrollLeft < setWidth * 0.5) jump(el, el.scrollLeft + setWidth);
      else if (el.scrollLeft > setWidth * 1.5) jump(el, el.scrollLeft - setWidth);
    }, 140);
  };
  useEffect(() => () => clearTimeout(settle.current), []);

  // Move on by one picture every four seconds, and stay still for a few seconds after someone touches the strip.
  useEffect(() => {
    if (!loop) return;
    const t = setInterval(() => {
      if (Date.now() - lastTouch.current < 8000) return;
      const m = measure();
      if (m) m.el.scrollBy({ left: m.step, behavior: "smooth" });
    }, 4000);
    return () => clearInterval(t);
  }, [loop, measure]);

  const goToDot = (i: number) => {
    lastTouch.current = Date.now();
    const m = measure();
    if (!m) return;
    const base = Math.floor(m.el.scrollLeft / m.setWidth) * m.setWidth;
    m.el.scrollTo({ left: base + i * m.step, behavior: "smooth" });
  };

  if (!banners || banners.length === 0) return null;

  const single = n === 1;
  const slides = Array.from({ length: copies }).flatMap((_, c) => banners.map((b) => ({ b, c })));

  return (
    <div style={{ position: "relative" }}>
      <div ref={trackRef} className="banner-track" onPointerDown={() => (lastTouch.current = Date.now())} onWheel={() => (lastTouch.current = Date.now())} onScroll={onScroll}>
        {slides.map(({ b, c }) => {
          const href = hrefOf(b);
          const img = (
            <div className="banner-slide-img" style={{ background: "var(--yellow)" }}>
              {b.imageUrl ? (
                <img src={b.imageUrl} alt={c === 0 || !loop ? b.title : ""} draggable={false} />
              ) : (
                <span style={{ color: "var(--maroon)", fontWeight: 900, fontSize: 22, padding: 20, alignSelf: "flex-end" }}>{b.title}</span>
              )}
            </div>
          );
          return (
            <div key={`${c}-${b.id}`} className={`banner-slide${single ? " single" : ""}`} aria-hidden={loop && c !== 1 ? true : undefined}>
              {href ? (
                href.startsWith("http") ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" tabIndex={loop && c !== 1 ? -1 : undefined}>
                    {img}
                  </a>
                ) : (
                  <Link href={href} tabIndex={loop && c !== 1 ? -1 : undefined}>
                    {img}
                  </Link>
                )
              ) : (
                img
              )}
            </div>
          );
        })}
      </div>

      {loop && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
          {banners.map((b, i) => (
            <button
              key={b.id}
              aria-label={`Banner ${i + 1}`}
              onClick={() => goToDot(i)}
              style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 3, background: i === index ? "var(--maroon)" : "var(--line)", transition: "all .2s" }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
