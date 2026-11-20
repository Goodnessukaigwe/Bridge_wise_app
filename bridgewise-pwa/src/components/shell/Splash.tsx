"use client";

import { useLayoutEffect, useState } from "react";

const KEY = "onrecord_last_open";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SHOW_MS = 1500;
const FADE_MS = 300;
const REDUCED_MS = 1000;

type Phase = "off" | "in" | "out";

function shouldShow(): boolean {
  if (window.location.pathname.startsWith("/share-target")) return false;
  let last: number | null = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    last = raw ? Number(raw) : null;
  } catch {
    return false;
  }
  if (last == null || !Number.isFinite(last)) return true;
  return Date.now() - last >= SEVEN_DAYS_MS;
}

/**
 * Overlay only. Never blocks the app underneath (pointer-events: none) and
 * works offline. Shown on first open and after 7+ days away.
 */
export function Splash() {
  const [phase, setPhase] = useState<Phase>("off");
  const [reduced, setReduced] = useState(false);

  useLayoutEffect(() => {
    const show = shouldShow();
    try {
      window.localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    if (!show) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setReduced(reduce);
    setPhase("in");
    const t1 = window.setTimeout(
      () => setPhase("out"),
      reduce ? REDUCED_MS : SHOW_MS,
    );
    const t2 = window.setTimeout(
      () => setPhase("off"),
      (reduce ? REDUCED_MS : SHOW_MS) + FADE_MS,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === "off") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#17104A]"
      style={{
        opacity: phase === "out" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/onrecord-icon.svg"
        alt=""
        className="size-28"
        style={reduced ? undefined : { animation: "splashLogo 600ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
      />
      <p
        className="mt-5 text-[30px] font-extrabold tracking-tight text-white"
        style={reduced ? undefined : { animation: "splashText 500ms ease-out 350ms both" }}
      >
        OnRecord
      </p>
      <p
        className="mt-2 px-8 text-center text-[15px] font-medium text-[#FCD58A]"
        style={reduced ? undefined : { animation: "splashText 500ms ease-out 650ms both" }}
      >
        Smarter Business. Better Growth.
      </p>
    </div>
  );
}
