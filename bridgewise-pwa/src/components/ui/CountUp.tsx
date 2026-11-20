"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 600;

/** Counts a Naira figure up to its value. Uses text updates only; skips motion if the vendor prefers it. */
export function CountUp({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === value) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);

  return <span className="amount">{format(shown)}</span>;
}
