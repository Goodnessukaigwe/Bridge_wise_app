"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSyncQueueCount } from "@/lib/db/hooks";
import { flushParseQueue } from "@/lib/sync/syncQueue";

export function TopBar({ onCapture }: { onCapture: () => void }) {
  const [online, setOnline] = useState(true);
  const queueLength = useSyncQueueCount();
  const synced = online && queueLength === 0;

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    const onOnline = () => {
      sync();
      void flushParseQueue();
    };
    sync();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", sync);
    if (navigator.onLine) void flushParseQueue();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`size-2.5 shrink-0 rounded-full ${online ? "bg-emerald-600" : "bg-red-600"}`}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold tracking-tight text-neutral-900">
            BridgeWise
          </p>
          <p className="truncate text-[11px] leading-tight text-neutral-500">
            Smarter Business. Better Growth.
          </p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${
            synced ? "text-emerald-800" : "text-amber-800"
          }`}
        >
          {synced ? "SYNCED" : "OFFLINE SAVED"}
        </span>
      </div>
      <button
        type="button"
        onClick={onCapture}
        aria-label="Capture"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white"
      >
        <Plus className="size-5" strokeWidth={2.5} aria-hidden />
      </button>
    </header>
  );
}
