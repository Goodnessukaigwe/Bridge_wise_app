"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { QuickCaptureModal } from "@/components/capture/QuickCaptureModal";
import { PocketStatement } from "@/components/finance/PocketStatement";
import { StockRoom } from "@/components/inventory/StockRoom";
import { OrderStream } from "@/components/orders/OrderStream";
import { BottomNav, type WorkspaceTab } from "@/components/shell/BottomNav";
import { TopBar } from "@/components/shell/TopBar";
import {
  EXPIRE_CHECK_INTERVAL_MS,
  expireStalePendingOrders,
} from "@/lib/db/transactions";

export default function Home() {
  const [tab, setTab] = useState<WorkspaceTab>("order");
  const [captureOpen, setCaptureOpen] = useState(false);

  useEffect(() => {
    void expireStalePendingOrders();
    const timer = window.setInterval(() => {
      void expireStalePendingOrders();
    }, EXPIRE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div key={tab} style={{ animation: "tabFadeIn 150ms ease" }}>
          {tab === "order" && <OrderStream />}
          {tab === "stock" && <StockRoom />}
          {tab === "statement" && <PocketStatement />}
        </div>
      </main>
      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        aria-label="Quick Capture"
        className="fixed bottom-[76px] right-5 z-30 flex size-14 items-center justify-center rounded-full bg-[#F59E0B] text-white shadow-[0_4px_14px_rgba(245,158,11,0.4)] active:scale-95"
      >
        <Plus className="size-6" strokeWidth={2.5} aria-hidden />
      </button>
      <BottomNav tab={tab} onTabChange={setTab} />
      <QuickCaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSaved={(kind) => {
          if (kind === "expense") setTab("statement");
          else if (kind === "restock") setTab("stock");
          else setTab("order");
        }}
      />
    </div>
  );
}
