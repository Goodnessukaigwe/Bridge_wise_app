"use client";

import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";
import { useCustomerSearch } from "@/components/customers/CustomerSearch";
import { CustomerRow } from "@/components/customers/CustomerRow";
import { EmptyState, InboxArt } from "@/components/ui/Illustrations";

/** All saved customers (header icon). Tapping one opens the history page. */
export function CustomersScreen({
  onClose,
  onOpenCustomer,
}: {
  onClose: () => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useCustomerSearch(query, true, 500);

  return (
    <div className="app-surface absolute inset-0 z-40 flex justify-center" style={{ animation: "tabFadeIn 200ms ease both" }}>
      <div className="flex h-full w-full max-w-md flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-5">
          <button type="button" onClick={onClose} aria-label="Back" className="icon-btn bg-white text-[#17104A] shadow-sm">
            <ArrowLeft className="size-5" />
          </button>
          <h2 className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">Customers</h2>
        </div>
        <div className="px-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[#6B6898]" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customers by name or phone"
              aria-label="Search all customers"
              className="field pl-11"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-10 pt-3">
          {rows === undefined ? null : rows.length === 0 ? (
            <EmptyState
              art={<InboxArt className="w-full" />}
              title={query ? "No customer found" : "No customers yet"}
              body={query ? "Try a different name or number." : "Customers appear here when you save an order."}
            />
          ) : (
            <ul className="card divide-y divide-[#F0EEF9] overflow-hidden">
              {rows.map((s, i) => (
                <CustomerRow key={s.customer.customer_id} summary={s} index={i} onOpen={onOpenCustomer} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
