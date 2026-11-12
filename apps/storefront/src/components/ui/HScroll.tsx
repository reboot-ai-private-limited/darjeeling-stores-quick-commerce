"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/** Click-and-drag scrolling for a horizontal strip, for mouse users (touch already scrolls natively). */
export function useDragScroll(ref: React.RefObject<HTMLElement | null>) {
  const state = useRef({ down: false, moved: false, startX: 0, startLeft: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      state.current = { down: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft };
    };
    const onMove = (e: MouseEvent) => {
      const s = state.current;
      if (!s.down) return;
      const dx = e.clientX - s.startX;
      if (!s.moved && Math.abs(dx) > 5) {
        s.moved = true;
        el.classList.add("is-dragging");
      }
      if (s.moved) {
        e.preventDefault();
        el.scrollLeft = s.startLeft - dx;
      }
    };
    const onUp = () => {
      const s = state.current;
      if (!s.down) return;
      s.down = false;
      el.classList.remove("is-dragging");
      // A drag must not count as a click on the card underneath.
      if (s.moved) setTimeout(() => (s.moved = false), 0);
    };
    const onClickCapture = (e: MouseEvent) => {
      if (state.current.moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onDragStart = (e: Event) => e.preventDefault(); // stop the browser dragging images/links

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("dragstart", onDragStart);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("dragstart", onDragStart);
    };
  }, [ref]);
}

interface HScrollProps {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/** A horizontal strip with arrow buttons (shown on hover with a mouse) and drag scrolling. */
export const HScroll: React.FC<HScrollProps> = ({ className = "rail", style, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  useDragScroll(ref);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update, children]);

  const nudge = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className="hscroll">
      {canLeft && (
        <button className="hscroll-btn left" aria-label="Scroll left" onClick={() => nudge(-1)}>
          <Icon name="chevron-right" size={20} className="flip" />
        </button>
      )}
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
      {canRight && (
        <button className="hscroll-btn right" aria-label="Scroll right" onClick={() => nudge(1)}>
          <Icon name="chevron-right" size={20} />
        </button>
      )}
    </div>
  );
};
