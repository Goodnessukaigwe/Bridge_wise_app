"use client";

import { Search, UserPlus, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { CustomerRow } from "@/components/customers/CustomerRow";
import { looksLikePhone } from "@/lib/db/customerMatch";
import { searchCustomers } from "@/lib/db/customerSearch";

const DEBOUNCE_MS = 150;

/** Debounced local search. Runs against IndexedDB, so it works offline. */
export function useCustomerSearch(query: string, enabled: boolean, limit = 20) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);
  return useLiveQuery(
    () => (enabled ? searchCustomers(debounced, limit) : []),
    [debounced, enabled, limit],
  );
}

/**
 * Search bar plus results. Empty and focused shows recent customers; no match
 * offers "Add as new customer".
 */
export function CustomerSearch({
  onOpenCustomer,
  onAddNew,
}: {
  onOpenCustomer: (customerId: string) => void;
  onAddNew: (who: { name: string; phone: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const active = open || q.trim().length > 0;
  const results = useCustomerSearch(q, active, 8);
  const typed = q.trim();

  return (
    <div
      className="mt-4"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !q.trim()) setOpen(false);
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[#6B6898]" aria-hidden />
        <input
          type="text"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search customers by name or phone"
          aria-label="Search customers by name or phone"
          autoComplete="off"
          className="field pl-11 pr-12"
        />
        {active ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQ("");
              setOpen(false);
              (document.activeElement as HTMLElement | null)?.blur?.();
            }}
            className="icon-btn absolute right-0.5 top-1/2 -translate-y-1/2 text-[#55517F]"
          >
            <X className="size-5" aria-hidden />
          </button>
        ) : null}
      </div>

      {active && results !== undefined ? (
        <div
          className="card anim-card mt-2 overflow-hidden"
          // Keep focus in the search box so a tap on a row is not lost.
          onPointerDown={(e) => e.preventDefault()}
        >
          {results.length > 0 ? (
            <>
              {!typed ? (
                <p className="px-4 pt-3 text-[12px] font-bold text-[#55517F]">Recent customers</p>
              ) : null}
              <ul className="divide-y divide-[#F0EEF9]">
                {results.map((s, i) => (
                  <CustomerRow
                    key={s.customer.customer_id}
                    summary={s}
                    index={i}
                    onOpen={(id) => {
                      setQ("");
                      setOpen(false);
                      onOpenCustomer(id);
                    }}
                  />
                ))}
              </ul>
            </>
          ) : typed ? (
            <div className="px-4 py-5 text-center">
              <p className="text-[16px] font-bold text-[#0F0A2E]">No customer found</p>
              <button
                type="button"
                onClick={() => {
                  const phone = looksLikePhone(typed);
                  setQ("");
                  setOpen(false);
                  onAddNew({ name: phone ? "" : typed, phone: phone ? typed : "" });
                }}
                className="btn btn-primary mt-3 w-full"
              >
                <UserPlus className="size-5" aria-hidden />
                Add as new customer
              </button>
            </div>
          ) : (
            <p className="px-4 py-5 text-center text-[15px] text-[#55517F]">
              Customers you save will show up here.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
