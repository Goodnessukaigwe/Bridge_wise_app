"use client";

import { useEffect, useState } from "react";
import { useSyncQueueCount } from "@/lib/db/hooks";
import { flushParseQueue } from "@/lib/sync/syncQueue";

export function TopBar() {
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
    <header className="flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/onrecord_icon_v3.svg"
        alt=""
        aria-hidden="true"
        className="size-9 shrink-0"
      />
      <p className="text-base font-semibold tracking-tight text-neutral-900">
        OnRecord
      </p>
      <span
        className={`text-[11px] font-semibold uppercase tracking-wide ${
          synced ? "text-emerald-800" : "text-amber-800"
        }`}
      >
        {synced ? "SYNCED" : "OFFLINE SAVED"}
      </span>
    </header>
  );
}
