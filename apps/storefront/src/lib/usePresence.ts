"use client";

import { useEffect, useState } from "react";

/**
 * Keeps a panel mounted long enough to play its closing animation.
 * `mounted` says whether to render it; `visible` flips a frame after mount (so the CSS transition has a start state)
 * and back to false the moment it should start leaving.
 */
export function usePresence(isOpen: boolean, exitMs = 320) {
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      // Two frames: first lets the element paint in its hidden state, second starts the transition.
      let r2 = 0;
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [isOpen, exitMs]);

  return { mounted, visible };
}
