"use client";

import { useEffect, useState } from "react";
import { CustomerPage } from "@/components/customers/CustomerPage";
import { CustomersScreen } from "@/components/customers/CustomersScreen";
import { BusinessSheet } from "@/components/shell/BusinessSheet";
import { DraggableFab } from "@/components/capture/DraggableFab";
import { AssistantSheet, type Incoming } from "@/components/assistant/AssistantSheet";
import { captureChatText } from "@/lib/ai/captureText";
import { hasAiConsent } from "@/lib/agent/consent";
import { takeSharedItem } from "@/lib/agent/shareInbox";
import type { CardOpen } from "@/lib/agent/types";
import { QuickCaptureModal } from "@/components/capture/QuickCaptureModal";
import { PocketStatement } from "@/components/finance/PocketStatement";
import { StockRoom } from "@/components/inventory/StockRoom";
import { OrderStream, type NewOrderPrefill } from "@/components/orders/OrderStream";
import { BottomNav, type WorkspaceTab } from "@/components/shell/BottomNav";
import { TopBar } from "@/components/shell/TopBar";
import {
  EXPIRE_CHECK_INTERVAL_MS,
  expireStalePendingOrders,
} from "@/lib/db/transactions";

export default function Home() {
  const [tab, setTab] = useState<WorkspaceTab>("order");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [businessOpen, setBusinessOpen] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const [pageOpen, setPageOpen] = useState(false);
  const [newOrderFor, setNewOrderFor] = useState<NewOrderPrefill | null>(null);

  function openCustomer(id: string) {
    setPageId(id);
    setPageOpen(true);
  }
  function closeCustomer() {
    setPageOpen(false);
    window.setTimeout(() => setPageId(null), 300);
  }

  function openFromCard(open: CardOpen) {
    setAssistantOpen(false);
    if (open.screen === "customer") openCustomer(open.customer_ref);
    else if (open.screen === "stock") setTab("stock");
    else if (open.screen === "statement") setTab("statement");
    else setTab("order");
  }

  // Android share sheet: the service worker keeps the shared item on the
  // phone and sends us here with ?share=. Open the assistant with it attached.
  // Text only while offline, or before the vendor has agreed to AI, is saved
  // as a raw draft exactly as before.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("share")) return;
    window.history.replaceState(null, "", "/");
    void takeSharedItem().then(async (item) => {
      if (!item || (!item.text && item.files.length === 0)) return;
      if (item.files.length === 0 && (!navigator.onLine || !hasAiConsent())) {
        await captureChatText({ raw_text: item.text, capture_method: "whatsapp_share_sheet" });
        setTab("order");
        return;
      }
      setIncoming({ text: item.text, files: item.files, token: Date.now() });
      setAssistantOpen(true);
    });
  }, []);

  useEffect(() => {
    void expireStalePendingOrders();
    const timer = window.setInterval(() => {
      void expireStalePendingOrders();
    }, EXPIRE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <TopBar
        onOpenCustomers={() => setCustomersOpen(true)}
        onOpenBusiness={() => setBusinessOpen(true)}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div key={tab} style={{ animation: "tabFadeIn 150ms ease" }}>
          {tab === "order" && (
            <OrderStream
              onOpenCustomer={openCustomer}
              newOrderFor={newOrderFor}
              onNewOrderConsumed={() => setNewOrderFor(null)}
            />
          )}
          {tab === "stock" && <StockRoom />}
          {tab === "statement" && <PocketStatement />}
        </div>
      </main>
      <DraggableFab onClick={() => setAssistantOpen(true)} />
      <BottomNav tab={tab} onTabChange={setTab} />
      {customersOpen ? (
        <CustomersScreen
          onClose={() => setCustomersOpen(false)}
          onOpenCustomer={openCustomer}
        />
      ) : null}
      {pageId ? (
        <CustomerPage
          key={pageId}
          customerId={pageId}
          open={pageOpen}
          onClose={closeCustomer}
          onNewOrder={(who) => {
            setTab("order");
            setNewOrderFor({ ...who, token: Date.now() });
            setCustomersOpen(false);
            closeCustomer();
          }}
        />
      ) : null}
      {businessOpen ? (
        <BusinessSheet onClose={() => setBusinessOpen(false)} />
      ) : null}
      {assistantOpen ? (
        <AssistantSheet
          incoming={incoming}
          onClose={() => setAssistantOpen(false)}
          onOpen={openFromCard}
          onQuickCapture={() => setCaptureOpen(true)}
        />
      ) : null}
      <QuickCaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSaved={(kind) => {
          setAssistantOpen(false);
          if (kind === "expense") setTab("statement");
          else if (kind === "restock") setTab("stock");
          else setTab("order");
        }}
      />
    </div>
  );
}
