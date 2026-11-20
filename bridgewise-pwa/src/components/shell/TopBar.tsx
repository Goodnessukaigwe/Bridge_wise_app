"use client";

import { Store, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useSyncQueueCount } from "@/lib/db/hooks";
import { flushParseQueue } from "@/lib/sync/syncQueue";

export function TopBar({
  onOpenCustomers,
  onOpenBusiness,
}: {
  onOpenCustomers: () => void;
  onOpenBusiness: () => void;
}) {
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
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-extrabold leading-tight tracking-tight text-white">
          OnRecord
        </p>
        <p
          role="status"
          className={`flex items-center gap-1.5 truncate text-[12px] font-semibold leading-tight ${
            !online ? "text-[#FDD9A6]" : queued ? "text-[#FCE7A8]" : "text-[#9FEACB]"
          }`}
        >
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full ${
              !online ? "bg-[#F97316]" : queued ? "bg-[#F59E0B]" : "bg-[#10B981]"
            }`}
          />
          {!online ? "Working offline" : queued ? "Waiting for network" : "Saved"}
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenCustomers}
        aria-label="Customers"
        className="icon-btn text-white active:bg-white/15"
      >
        <Users className="size-6" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onOpenBusiness}
        aria-label="Your business details"
        className="icon-btn -mr-1 text-white active:bg-white/15"
      >
        <Store className="size-6" aria-hidden />
      </button>
    </header>
  );
}
