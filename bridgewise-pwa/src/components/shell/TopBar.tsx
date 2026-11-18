"use client";

import { useEffect, useState } from "react";
import { useSyncQueueCount } from "@/lib/db/hooks";
import { flushParseQueue } from "@/lib/sync/syncQueue";

export function TopBar() {
  const [online, setOnline] = useState(true);
  const queueLength = useSyncQueueCount();

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

  const queued = online && (queueLength ?? 0) > 0;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-[#17104A] px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/onrecord_icon_v3.svg"
        alt=""
        aria-hidden="true"
        className="size-9 shrink-0"
      />
      <p className="text-[17px] font-semibold tracking-tight text-white">
        OnRecord
      </p>
      <span
        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white ${
          !online
            ? "bg-neutral-500/40"
            : queued
              ? "bg-amber-500/40"
              : "bg-emerald-500/40"
        }`}
      >
        {!online ? "OFFLINE" : queued ? "QUEUED" : "SYNCED"}
      </span>
    </header>
  );
}
