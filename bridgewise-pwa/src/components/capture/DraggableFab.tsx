"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "fab_position";
const SIZE = 56; // size-14
const EDGE_GAP = 20;
const DEFAULT_BOTTOM = 80;
const DRAG_THRESHOLD = 5;

type Edge = "left" | "right";
type Resting = { edge: Edge; bottom: number };

function loadPosition(): Resting {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Resting>;
      if (
        (p.edge === "left" || p.edge === "right") &&
        typeof p.bottom === "number" &&
        Number.isFinite(p.bottom)
      ) {
        return { edge: p.edge, bottom: p.bottom };
      }
    }
  } catch {
    /* ignore */
  }
  return { edge: "right", bottom: DEFAULT_BOTTOM };
}

/**
 * Quick Capture FAB. Positioned absolutely inside its offset parent (the app
 * container), draggable, and snaps to the nearest left/right edge on release.
 */
export function DraggableFab({ onClick }: { onClick: () => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [resting, setResting] = useState<Resting>({
    edge: "right",
    bottom: DEFAULT_BOTTOM,
  });
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const session = useRef<{
    id: number;
    startX: number;
    startY: number;
    offX: number;
    offY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setResting(loadPosition());
  }, []);

  function bounds() {
    const container = btnRef.current?.parentElement;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const header = container.querySelector("header")?.getBoundingClientRect();
    const nav = container.querySelector("nav")?.getBoundingClientRect();
    const minTop = header ? header.bottom - rect.top : 0;
    const navH = nav ? rect.bottom - nav.top : 0;
    const maxTop = rect.height - navH - SIZE;
    return { rect, minTop, maxTop: Math.max(minTop, maxTop), navH };
  }

  // Re-clamp the saved offset if the container size changes.
  useEffect(() => {
    function reclamp() {
      const b = bounds();
      if (!b) return;
      setResting((r) => {
        const maxBottom = b.rect.height - b.minTop - SIZE;
        const bottom = Math.min(Math.max(r.bottom, b.navH), Math.max(b.navH, maxBottom));
        return bottom === r.bottom ? r : { ...r, bottom };
      });
    }
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const btn = e.currentTarget;
    const r = btn.getBoundingClientRect();
    session.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - r.left,
      offY: e.clientY - r.top,
      moved: false,
    };
    btn.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const s = session.current;
    const b = bounds();
    if (!s || s.id !== e.pointerId || !b) return;
    if (
      !s.moved &&
      Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD
    ) {
      return;
    }
    s.moved = true;
    const left = Math.min(
      Math.max(e.clientX - s.offX - b.rect.left, 0),
      b.rect.width - SIZE,
    );
    const top = Math.min(
      Math.max(e.clientY - s.offY - b.rect.top, b.minTop),
      b.maxTop,
    );
    setDrag({ left, top });
  }

  function finish(e: React.PointerEvent<HTMLButtonElement>) {
    const s = session.current;
    if (!s || s.id !== e.pointerId) return;
    session.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!s.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    const b = bounds();
    if (b && drag) {
      const edge: Edge =
        drag.left + SIZE / 2 < b.rect.width / 2 ? "left" : "right";
      const next: Resting = {
        edge,
        bottom: b.rect.height - drag.top - SIZE,
      };
      setResting(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
    setDrag(null);
  }

  const style: React.CSSProperties = drag
    ? { left: drag.left, top: drag.top, touchAction: "none" }
    : {
        [resting.edge]: EDGE_GAP,
        bottom: resting.bottom,
        touchAction: "none",
      };

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => {
        if (suppressClick.current) return;
        onClick();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      aria-label="Ask the OnRecord assistant"
      style={style}
      className={`absolute z-30 flex size-14 select-none items-center justify-center rounded-full bg-[#F59E0B] text-white shadow-[0_4px_14px_rgba(245,158,11,0.4)] ${
        drag ? "" : "active:scale-95"
      }`}
    >
      <Sparkles className="size-6" strokeWidth={2.25} aria-hidden />
    </button>
  );
}
