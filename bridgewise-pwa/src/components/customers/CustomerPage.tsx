"use client";

import { ArrowLeft, ChevronDown, MessageCircle, Plus, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/customers/CustomerRow";
import { ReceiptSheet } from "@/components/orders/ReceiptSheet";
import { EmptyState, InboxArt } from "@/components/ui/Illustrations";
import { PhoneField } from "@/components/ui/PhoneField";
import { CountUp } from "@/components/ui/CountUp";
import { buildCustomerIndex } from "@/lib/db/customerMatch";
import { saveCustomerPhone } from "@/lib/db/customers";
import { formatShortDate } from "@/lib/db/customerSearch";
import { useCustomers, useOrders } from "@/lib/db/hooks";
import { formatPhoneDisplay, normalisePhone, openLink } from "@/lib/whatsapp";
import type { Order, OrderLine } from "@/types/bridgewise";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const gross = (items: OrderLine[]) =>
  items.reduce((s, l) => s + l.unit_selling_price * l.quantity, 0);

function statusOf(o: Order): { label: string; cls: string } {
  switch (o.status) {
    case "CONFIRMED_SALE":
      return { label: "Paid", cls: "pill-green" };
    case "PENDING_INQUIRY":
      return { label: "Not paid yet", cls: "pill-amber" };
    case "CANCELLED":
      return { label: "Cancelled", cls: "pill-grey" };
    case "EXPIRED":
      return { label: "Expired", cls: "pill-grey" };
    case "REFUNDED":
      return { label: "Returned", cls: "pill-orange" };
  }
}

/**
 * Full-screen customer history. Slides in from the right and back out.
 * Read-only for orders; only the phone number can be edited here.
 */
export function CustomerPage({
  customerId,
  open,
  onClose,
  onNewOrder,
}: {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onNewOrder: (who: { name: string; phone: string }) => void;
}) {
  const customers = useCustomers();
  const orders = useOrders();
  const [entered, setEntered] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const customer = customers?.find((c) => c.customer_id === customerId);

  const mine = useMemo(() => {
    if (!customers || !orders) return [];
    const idx = buildCustomerIndex(customers);
    return orders
      .filter((o) => idx.forOrder(o)?.customer_id === customerId)
      .sort((a, b) =>
        a.date_key !== b.date_key
          ? b.date_key.localeCompare(a.date_key)
          : b.seq - a.seq,
      );
  }, [customers, orders, customerId]);

  const spent = mine
    .filter((o) => o.status === "CONFIRMED_SALE" && o.ledger_committed)
    .reduce((s, o) => s + gross(o.items), 0);
  const last = mine[0]?.date_key ?? null;
  const phone = customer?.phone ?? "";
  const shown = formatPhoneDisplay(phone);
  const value = draft ?? shown;
  const wa = normalisePhone(phone);
  const receiptOrder = mine.find((o) => o.order_id === receiptFor);

  async function savePhone() {
    if (!customer) return;
    await saveCustomerPhone(customer.customer_id, value);
    setDraft(null);
    setNote(
      value.trim() && !normalisePhone(value)
        ? "Saved. This number may not work on WhatsApp, so check it."
        : value.trim()
          ? "Number saved."
          : "Number removed.",
    );
  }

  return (
    <div
      className="anim-drill app-surface absolute inset-0 z-40 flex justify-center"
      style={{
        transform: entered && open ? "translateX(0)" : "translateX(100%)",
      }}
    >
      <div className="flex h-full w-full max-w-md flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-5">
          <button type="button" onClick={onClose} aria-label="Back" className="icon-btn bg-white text-[#17104A] shadow-sm">
            <ArrowLeft className="size-5" />
          </button>
          <h2 className="text-[18px] font-extrabold tracking-tight text-[#0F0A2E]">Customer</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-10">
          {!customer ? null : (
            <>
              <div className="card flex flex-col items-center px-4 pb-4 pt-5 text-center">
                <Avatar name={customer.name} size="lg" />
                <p className="mt-2 text-[22px] font-extrabold leading-tight tracking-tight text-[#0F0A2E]">{customer.name}</p>
                <p className="amount text-[15px] text-[#55517F]">{shown || "No phone number yet"}</p>
                <div className="mt-3 grid w-full grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={!wa}
                    onClick={() => wa && openLink(`https://wa.me/${wa}`)}
                    className="btn btn-success"
                  >
                    <MessageCircle className="size-5" aria-hidden />
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => onNewOrder({ name: customer.name, phone })}
                    className="btn btn-primary"
                  >
                    <Plus className="size-5" strokeWidth={2.5} aria-hidden />
                    New order
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2.5">
                <div className="card px-3 py-3">
                  <p className="text-[12px] font-bold text-[#55517F]">Total spent</p>
                  <p className="mt-0.5 text-[16px] font-extrabold leading-tight text-[#17104A]">
                    <CountUp value={spent} format={naira} />
                  </p>
                </div>
                <div className="card px-3 py-3">
                  <p className="text-[12px] font-bold text-[#55517F]">Orders</p>
                  <p className="amount mt-0.5 text-[16px] font-extrabold leading-tight text-[#17104A]">{mine.length}</p>
                </div>
                <div className="card px-3 py-3">
                  <p className="text-[12px] font-bold text-[#55517F]">Last order</p>
                  <p className="mt-0.5 text-[14px] font-extrabold leading-tight text-[#17104A]">
                    {last ? formatShortDate(last) : "—"}
                  </p>
                </div>
              </div>

              <div className="card mt-3 px-4 py-3.5">
                <PhoneField
                  value={value}
                  onChange={(v) => {
                    setDraft(v);
                    setNote(null);
                  }}
                  label="Phone number"
                  ariaLabel="Customer phone number"
                />
                {draft !== null && draft.trim() !== shown.trim() ? (
                  <button type="button" onClick={() => void savePhone()} className="btn btn-secondary mt-2 w-full">
                    Save number
                  </button>
                ) : null}
                {note ? (
                  <p className="mt-1 text-[13px] font-semibold text-[#55517F]" role="status">
                    {note}
                  </p>
                ) : null}
              </div>

              <h3 className="mt-5 text-[17px] font-extrabold tracking-tight text-[#0F0A2E]">Orders</h3>
              {mine.length === 0 ? (
                <EmptyState
                  art={<InboxArt className="w-full" />}
                  title="No orders yet"
                  body="Tap New order to add the first one for this customer."
                />
              ) : (
                <ul className="mt-2 flex flex-col gap-2.5">
                  {mine.map((o, i) => {
                    const st = statusOf(o);
                    const isOpen = expanded === o.order_id;
                    return (
                      <li key={o.order_id} className="anim-card card overflow-hidden" style={{ ["--i" as string]: Math.min(i, 8) }}>
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : o.order_id)}
                          aria-expanded={isOpen}
                          className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold text-[#55517F]">{formatShortDate(o.date_key)}</span>
                            <span className="block truncate text-[15px] font-bold text-[#0F0A2E]">
                              {o.items.length === 0
                                ? "Chat not matched to a product yet"
                                : o.items.map((l) => `${l.quantity}× ${l.product_name}`).join(", ")}
                            </span>
                            <span className="mt-1 flex items-center gap-2">
                              <span className="amount text-[15px] font-extrabold text-[#17104A]">
                                {o.items.length ? naira(gross(o.items)) : "—"}
                              </span>
                              <span className={`pill ${st.cls}`}>{st.label}</span>
                            </span>
                          </span>
                          <ChevronDown
                            className={`size-5 shrink-0 text-[#6B6898] transition-transform ${isOpen ? "rotate-180" : ""}`}
                            aria-hidden
                          />
                        </button>
                        {isOpen ? (
                          <div className="border-t border-[#F0EEF9] px-4 py-3">
                            <p className="text-[13px] font-semibold text-[#55517F]">
                              Order {o.seq}, {formatShortDate(o.date_key)}
                            </p>
                            <ul className="mt-1.5 flex flex-col gap-1">
                              {o.items.map((l, k) => (
                                <li key={k} className="flex items-start justify-between gap-3 text-[14px]">
                                  <span className="min-w-0 text-[#0F0A2E]">
                                    {l.quantity}× {l.product_name}
                                  </span>
                                  <span className="amount shrink-0 font-semibold text-[#0F0A2E]">
                                    {naira(l.unit_selling_price * l.quantity)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-[14px] text-[#55517F]">
                              {o.delivery_address.trim()
                                ? `Delivery: ${o.delivery_address}`
                                : "No delivery address"}
                            </p>
                            {o.status === "CONFIRMED_SALE" && o.ledger_committed ? (
                              <button type="button" onClick={() => setReceiptFor(o.order_id)} className="btn btn-primary mt-3 w-full">
                                <Send className="size-5" aria-hidden />
                                Send receipt
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      {receiptOrder ? (
        <ReceiptSheet order={receiptOrder} phone={phone || undefined} onClose={() => setReceiptFor(null)} />
      ) : null}
    </div>
  );
}
