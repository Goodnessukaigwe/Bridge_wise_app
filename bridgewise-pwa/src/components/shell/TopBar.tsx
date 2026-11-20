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
    <header className="flex h-14 shrink-0 items-center gap-2.5 bg-gradient-to-b from-[#241A6E] to-[#17104A] px-4 shadow-[0_4px_14px_-6px_rgba(23,16,74,0.6)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/onrecord-icon.svg"
        alt=""
        aria-hidden="true"
        className="size-9 shrink-0"
      />
      <p className="text-[18px] font-extrabold tracking-tight text-white">
        OnRecord
      </p>
      <span
        role="status"
        className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold ${
          !online
            ? "bg-[#FDE7C8] text-[#7A4300]"
            : queued
              ? "bg-[#FEF0C7] text-[#7A4300]"
              : "bg-[#D3F5E5] text-[#065F46]"
        }`}
      >
        <span
          aria-hidden
          className={`size-2 rounded-full ${
            !online ? "bg-[#F97316]" : queued ? "bg-[#F59E0B]" : "bg-[#10B981]"
          }`}
        />
        {!online ? "Working offline" : queued ? "Waiting for network" : "Saved"}
      </span>
    </header>
  );
}
