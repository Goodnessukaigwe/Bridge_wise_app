"use client";

import { ArrowLeft, Search, Users, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { PhoneField } from "@/components/ui/PhoneField";
import { EmptyState, InboxArt } from "@/components/ui/Illustrations";
import { setCustomerPhone } from "@/lib/db/customers";
import { customerId } from "@/lib/db/dexie";
import { useCustomers, useOrders } from "@/lib/db/hooks";
import type { Customer } from "@/types/bridgewise";

function EditPhone({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const titleId = useId();
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[55] flex justify-center">
      <div className="sheet-backdrop relative flex h-full w-full max-w-md items-end">
        <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="sheet-panel relative w-full px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
          <div className="sheet-grab" />
          <div className="mb-3 flex items-center justify-between">
            <h2 id={titleId} className="truncate text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
              {customer.name}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="icon-btn bg-[#F1F0F8] text-[#3B3670]">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <PhoneField value={phone} onChange={setPhone} />
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await setCustomerPhone(customer.name, phone);
              onClose();
            }}
            className="btn btn-primary mt-4 min-h-[54px] w-full"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomersScreen({ onClose }: { onClose: () => void }) {
  const customers = useCustomers();
  const orders = useOrders();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders ?? []) {
      if (o.status === "CANCELLED" || o.status === "EXPIRED") continue;
      const id = customerId(o.customer_name);
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [orders]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(customers ?? [])]
      .filter((c) => {
        if (!q) return true;
        if (c.name.toLowerCase().includes(q)) return true;
        // 0803… must find 234803…, so ignore leading zeros.
        const digits = q.replace(/\D/g, "").replace(/^0+/, "");
        return !!digits && (c.phone ?? "").replace(/\D/g, "").includes(digits);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, query]);

  const editingCustomer = customers?.find((c) => c.customer_id === editing);

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
              placeholder="Search by name or number"
              aria-label="Search customers"
              className="field pl-11"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-10 pt-3">
          {customers === undefined ? null : rows.length === 0 ? (
            <EmptyState
              art={<InboxArt className="w-full" />}
              title={query ? "No one found" : "No customers yet"}
              body={query ? "Try a different name or number." : "Customers appear here when you save an order."}
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {rows.map((c, i) => {
                const n = counts.get(c.customer_id) ?? 0;
                return (
                  <li key={c.customer_id} className="anim-card" style={{ ["--i" as string]: Math.min(i, 8) }}>
                    <button type="button" onClick={() => setEditing(c.customer_id)} className="card flex w-full items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.985]">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#ECE9FB] text-[#17104A]">
                        <Users className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-bold text-[#0F0A2E]">{c.name}</span>
                        <span className="amount block truncate text-[14px] text-[#55517F]">
                          {c.phone ? c.phone : "Add phone number"}
                        </span>
                      </span>
                      <span className="pill pill-indigo shrink-0">
                        {n} order{n !== 1 ? "s" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {editingCustomer ? <EditPhone key={editingCustomer.customer_id} customer={editingCustomer} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
