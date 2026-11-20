"use client";

import { useEffect, useState } from "react";
import { DraggableFab } from "@/components/capture/DraggableFab";
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
      <DraggableFab onClick={() => setCaptureOpen(true)} />
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
