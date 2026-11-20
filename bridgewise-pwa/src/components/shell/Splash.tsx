"use client";

import { useLayoutEffect, useRef, useState } from "react";

const SHOW_MS = 1200;
const FADE_MS = 300;
const REDUCED_MS = 1000;

type Phase = "off" | "in" | "out";

/** Once per page load. A fresh launch reloads the page, so the flag resets. */
let shownThisLoad = false;

/**
 * Overlay only: the real app loads and runs behind it. Plays on every fresh
 * launch (except from the Share Target), once per page load, and can be
 * tapped to skip. Works offline: no network use.
 */
export function Splash() {
  const [phase, setPhase] = useState<Phase>("off");
  const [reduced, setReduced] = useState(false);
  const timers = useRef<number[]>([]);

  useLayoutEffect(() => {
    if (shownThisLoad) return;
    shownThisLoad = true;
    if (window.location.pathname.startsWith("/share-target")) return;

    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const hold = reduce ? REDUCED_MS : SHOW_MS;
    setReduced(reduce);
    setPhase("in");
    timers.current = [
      window.setTimeout(() => setPhase("out"), hold),
      window.setTimeout(() => setPhase("off"), hold + FADE_MS),
    ];
    return () => timers.current.forEach(window.clearTimeout);
  }, []);

  function skip() {
    if (phase !== "in") return;
    timers.current.forEach(window.clearTimeout);
    setPhase("out");
    timers.current = [window.setTimeout(() => setPhase("off"), FADE_MS)];
  }

  if (phase === "off") return null;

  return (
    <div
      aria-hidden="true"
      onPointerDown={skip}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#17104A] ${
        phase === "out" ? "pointer-events-none" : ""
      }`}
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
