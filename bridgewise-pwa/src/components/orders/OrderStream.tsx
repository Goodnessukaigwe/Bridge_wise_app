"use client";

import { Check, Plus, RotateCcw, Share2, X } from "lucide-react";
import { EmptyState, InboxArt } from "@/components/ui/Illustrations";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { isWalkInName } from "@/lib/ai/identity";
import { attachCustomerToWalkInOrder, setCustomerPhone } from "@/lib/db/customers";
import { canPickContacts, normalisePhone, pickContactPhone } from "@/lib/whatsapp";
import { customerId } from "@/lib/db/dexie";
import {
  cancelOrArchiveOrder,
  commitConfirmedOrder,
  createPendingOrder,
  deleteOrders,
  expireStalePendingOrders,
  PENDING_TTL_MS,
  processReturn,
  type CommitOrderResult,
  type ReturnOrderResult,
} from "@/lib/db/transactions";
import { useCustomers, useOrders, useSkus } from "@/lib/db/hooks";
import { shareReceipt } from "@/components/orders/ReceiptGenerator";
import type {
  CaptureMethod,
  Customer,
  Order,
  OrderLine,
  Sku,
} from "@/types/bridgewise";

const SHOE_SKU = "Black_Shoes_Size42";
const CAKE_SKU = "Red_Velvet_Cake_8in";
const isDev = process.env.NODE_ENV !== "production";

const fieldClass = "field";

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatLines(items: OrderLine[]): string {
  return items
    .map((line) => `${line.quantity}× ${line.product_name}`)
    .join(", ");
}

function orderGross(items: OrderLine[]): number {
  return items.reduce(
    (sum, line) => sum + line.unit_selling_price * line.quantity,
    0,
  );
}

function newestFirst(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    if (a.date_key !== b.date_key) return b.date_key.localeCompare(a.date_key);
    return b.seq - a.seq;
  });
}

function isInboxVisible(order: Order): boolean {
  return order.status !== "CANCELLED" && order.status !== "EXPIRED";
}

function parsePositiveInt(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return NaN;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return NaN;
  return Math.trunc(value);
}

function productNameFor(id: string | undefined, skus: Sku[]): string {
  if (!id) return "";
  return skus.find((s) => s.sku_id === id)?.display_name ?? "";
}

function orderLabel(order: Pick<Order, "seq" | "date_key">): string {
  return `Order ${order.seq}, ${formatDateKey(order.date_key)}`;
}

function formatCommitError(
  result: CommitOrderResult,
  skus: Sku[],
): string | null {
  if (result.outcome !== "aborted") return null;
  if (result.reason === "empty_items") {
    return "We could not find a product in this chat yet. Pick one before you mark it as sold.";
  }
  const name = productNameFor(result.sku_id, skus);
  const forName = name ? ` for ${name}` : "";
  if (result.reason === "out_of_stock") {
    return `Not enough in stock${forName}. Nothing was changed. Add new stock first.`;
  }
  return `We could not find that product${name ? ` (${name})` : ""}. Nothing was changed.`;
}

function captureLabel(method: CaptureMethod): string {
  switch (method) {
    case "clipboard":
      return "Pasted in";
    case "whatsapp_share_sheet":
      return "Shared from WhatsApp";
    case "manual":
      return "Typed in";
  }
}

function orderNeedsRestock(order: Order, skus: Sku[]): boolean {
  if (order.items.length === 0) return false;
  const byId = new Map(skus.map((sku) => [sku.sku_id, sku]));
  const needed = new Map<string, number>();
  for (const line of order.items) {
    needed.set(
      line.product_id,
      (needed.get(line.product_id) ?? 0) + line.quantity,
    );
  }
  for (const [skuId, quantity] of needed) {
    const sku = byId.get(skuId);
    if (!sku || sku.stock_qty <= 0 || sku.stock_qty < quantity) return true;
  }
  return false;
}

function formatReturnError(
  result: ReturnOrderResult,
  skus: Sku[],
): string | null {
  if (result.outcome !== "aborted") return null;
  const name = productNameFor(result.sku_id, skus);
  return `We cannot log this return because the product${name ? ` (${name})` : ""} is no longer in your Stock Room.`;
}

function intentLabel(order: Order): string {
  if (
    order.intent_classification === "HIGH_PURCHASE_INTENT" ||
    order.suggested_status === "READY_TO_CONFIRM"
  ) {
    return "Ready to buy";
  }
  return "Just asking";
}

function hasPaymentSignal(order: Order): boolean {
  return (
    order.payment_signal_detected === true ||
    order.suggested_status === "READY_TO_CONFIRM" ||
    order.intent_classification === "HIGH_PURCHASE_INTENT"
  );
}

function confirmCtaLabel(order: Order): string {
  return hasPaymentSignal(order)
    ? "Mark as sold and update stock"
    : "Mark as sold";
}

function formatDateKey(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  const d = new Date(parts[0] ?? 2000, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  return d.toLocaleDateString("en-NG", { month: "short", day: "numeric" });
}

function recentCustomers(customers: Customer[], orders: Order[]): Customer[] {
  const rank = new Map<string, number>();
  newestFirst(orders).forEach((order, index) => {
    if (isWalkInName(order.customer_name)) return;
    const id = customerId(order.customer_name);
    if (!rank.has(id)) rank.set(id, index);
  });
  return [...customers].sort((a, b) => {
    const byRecency =
      (rank.get(a.customer_id) ?? Number.POSITIVE_INFINITY) -
      (rank.get(b.customer_id) ?? Number.POSITIVE_INFINITY);
    if (byRecency !== 0) return byRecency;
    return a.name.localeCompare(b.name);
  });
}

function WalkInCustomerPicker({
  customers,
  disabled,
  onPick,
}: {
  customers: Customer[];
  disabled: boolean;
  onPick: (customerId: string) => void;
}) {
  if (customers.length === 0) return null;
  const recent = customers[0];

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(recent.customer_id)}
        className="btn btn-quiet"
      >
        Use {recent.name}
        {recent.saved_addresses[0] ? ` · ${recent.saved_addresses[0]}` : ""}
      </button>
      {customers.length > 1 ? (
        <label className="label">
          Or pick someone else
          <select
            className={`${fieldClass} mt-1`}
            value=""
            disabled={disabled}
            aria-label="Pick a saved customer for this order"
            onChange={(event) => {
              const id = event.target.value;
              if (id) onPick(id);
            }}
          >
            <option value="">Your customers</option>
            {customers.map((customer) => (
              <option key={customer.customer_id} value={customer.customer_id}>
                {customer.name}
                {customer.saved_addresses[0]
                  ? ` · ${customer.saved_addresses[0]}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function NewInquirySheet({
  skus,
  onClose,
}: {
  skus: Sku[];
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [skuId, setSkuId] = useState(skus[0]?.sku_id ?? "");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = skus.find((sku) => sku.sku_id === skuId);
  const parsedQty = parsePositiveInt(qty);
  const shortOnHand =
    selected && Number.isInteger(parsedQty) && parsedQty > 0
      ? selected.stock_qty < parsedQty
      : false;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const customer = name.trim();
    if (!customer) {
      setError("Please type the customer’s name");
      return;
    }
    if (!skuId) {
      setError("Please pick a product");
      return;
    }
    if (!Number.isInteger(parsedQty) || parsedQty < 1) {
      setError("How many must be a whole number, 1 or more");
      return;
    }

    setBusy(true);
    try {
      await createPendingOrder({
        customer_name: customer,
        delivery_address: address.trim(),
        items: [{ product_id: skuId, quantity: parsedQty }],
        capture_method: "manual",
        intent_classification: "INQUIRY",
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="sheet-backdrop relative flex h-full w-full max-w-md items-end">
        <button
          type="button"
          className="absolute inset-0"
          aria-label="Close"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="sheet-panel relative max-h-[90%] w-full overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className="sheet-grab" />
          <div className="mb-2 flex items-center justify-between">
            <h2 id={titleId} className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
              New order
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="icon-btn bg-[#F1F0F8] text-[#3B3670]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <p className="mb-4 text-[15px] leading-relaxed text-[#55517F]">
            This saves the order as <b>Not paid yet</b>. Your stock and money
            stay the same until you tap <b>Mark as sold</b>.
          </p>
          {skus.length === 0 ? (
            <p className="text-[15px] text-[#55517F]">
              Add a product in Stock Room first, then you can save an order.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label className="label">
                Customer name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`${fieldClass} mt-1`}
                  autoComplete="name"
                  placeholder="Chioma"
                />
              </label>
              <label className="label">
                Delivery address
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={`${fieldClass} mt-1`}
                  autoComplete="street-address"
                  placeholder="Lekki Phase 1"
                />
              </label>
              <label className="label">
                Product
                <select
                  required
                  value={skuId}
                  onChange={(e) => setSkuId(e.target.value)}
                  className={`${fieldClass} mt-1`}
                >
                  {skus.map((sku) => (
                    <option key={sku.sku_id} value={sku.sku_id}>
                      {sku.display_name} · {sku.stock_qty} left ·{" "}
                      {formatNaira(sku.unit_selling_price)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                How many?
                <input
                  required
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={`${fieldClass} mt-1`}
                />
              </label>
              {shortOnHand ? (
                <p className="rounded-xl bg-[#FEF0C7] px-3 py-2 text-[14px] font-semibold leading-relaxed text-[#7A4300]">
                  You only have {selected?.stock_qty} in stock. You can still
                  save this order, but add new stock before you mark it as sold.
                </p>
              ) : null}
              {error ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="btn btn-primary mt-1 min-h-[54px]"
              >
                {busy ? "Saving…" : "Save order"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderDetailSheet({
  order,
  allOrders,
  skus,
  customers,
  recent,
  busy,
  error,
  onConfirm,
  onCancel,
  onReturn,
  onAttachCustomer,
  onClose,
}: {
  order: Order;
  allOrders: Order[];
  skus: Sku[];
  customers: Customer[];
  recent: Customer[];
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onReturn: () => void;
  onAttachCustomer: (customerId: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<"details" | "history">("details");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareFailed, setShareFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [phoneNote, setPhoneNote] = useState<string | null>(null);

  const pending = order.status === "PENDING_INQUIRY" && !order.ledger_committed;
  const confirmed = order.status === "CONFIRMED_SALE" && order.ledger_committed;
  const unparsed = pending && order.items.length === 0;
  const needsRestock = pending && !unparsed && orderNeedsRestock(order, skus);
  const walkIn = isWalkInName(order.customer_name);
  const linked = walkIn
    ? undefined
    : customers.find(
        (c) => c.customer_id === customerId(order.customer_name),
      );
  const gross = orderGross(order.items);
  const snippet =
    order.delivery_address.trim() || linked?.saved_addresses[0] || "";
  const rawSnippet = order.raw_text?.trim() ?? "";

  const history = useMemo(() => {
    if (walkIn) return [];
    const cid = customerId(order.customer_name);
    return newestFirst(
      allOrders.filter(
        (o) =>
          o.status === "CONFIRMED_SALE" &&
          o.ledger_committed &&
          o.order_id !== order.order_id &&
          customerId(o.customer_name) === cid,
      ),
    );
  }, [allOrders, order, walkIn]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const savedPhone = normalisePhone(linked?.phone);

  async function savePhone(raw: string) {
    const result = await setCustomerPhone(order.customer_name, raw);
    if (result === "invalid") {
      setPhoneNote("That number does not look right, so we have not saved it.");
      return;
    }
    setPhoneNote(result === "saved" ? "Number saved." : null);
    setPhoneEditing(false);
  }

  async function pickFromContacts() {
    const picked = await pickContactPhone();
    if (picked) {
      setPhoneDraft(picked);
      await savePhone(picked);
    }
  }

  async function onShare() {
    if (sharing) return;
    setSharing(true);
    setShareStatus(null);
    setShareFailed(false);
    try {
      const result = await shareReceipt(order, savedPhone);
      if (result.status === "whatsapp") setShareStatus("Opening WhatsApp…");
      else if (result.status === "shared") setShareStatus("Receipt shared");
      else if (result.status === "copied") setShareStatus("Receipt copied. Paste it in WhatsApp.");
      else if (result.status === "cancelled") setShareStatus("Receipt not shared");
      else {
        setShareFailed(true);
        setShareStatus(result.message);
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="sheet-backdrop relative flex h-full w-full max-w-md items-end">
        <button
          type="button"
          className="absolute inset-0"
          aria-label="Close"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="sheet-panel relative max-h-[90%] w-full overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        >
          {/* Sheet header */}
          <div className="sheet-grab" />
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="truncate text-[20px] font-extrabold tracking-tight text-[#0F0A2E]"
              >
                {order.customer_name}
              </h2>
              <p className="text-[13px] font-medium text-[#55517F]">
                {orderLabel(order)}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="icon-btn shrink-0 bg-[#F1F0F8] text-[#3B3670]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {/* Tab switcher */}
          <div className="mb-4 flex gap-1 rounded-2xl bg-[#F1F0F8] p-1">
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`min-h-11 flex-1 rounded-xl py-2 text-[15px] font-bold transition-colors ${
                activeTab === "details"
                  ? "bg-white text-[#17104A] shadow-sm"
                  : "text-[#55517F]"
              }`}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`min-h-11 flex-1 rounded-xl py-2 text-[15px] font-bold transition-colors ${
                activeTab === "history"
                  ? "bg-white text-[#17104A] shadow-sm"
                  : "text-[#55517F]"
              }`}
            >
              Past orders{history.length > 0 ? ` (${history.length})` : ""}
            </button>
          </div>

          {/* Details tab */}
          {activeTab === "details" && (
            <div>
              <span
                className={`pill ${
                  pending ? "pill-amber" : "pill-green"
                }`}
              >
                {pending ? "Not paid yet" : "Sold"}
              </span>

              {unparsed ? (
                <>
                  {rawSnippet ? (
                    <p className="mt-3 line-clamp-4 whitespace-pre-wrap rounded-2xl bg-[#F4F3FF] p-3 text-[15px] text-[#0F0A2E]">
                      {rawSnippet}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[14px] font-semibold text-[#7A4300]">
                    We could not find a product in this chat yet. You cannot
                    mark it as sold until one is matched.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[17px] font-bold text-[#0F0A2E]">
                    {formatLines(order.items)}
                  </p>
                  <p className="amount mt-0.5 text-[24px] font-extrabold text-[#17104A]">
                    {formatNaira(gross)}
                  </p>
                  {rawSnippet ? (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-2xl bg-[#F4F3FF] p-3 text-[14px] text-[#3B3670]">
                      {rawSnippet}
                    </p>
                  ) : snippet ? (
                    <p className="mt-2 line-clamp-2 text-[15px] text-[#3B3670]">
                      {snippet}
                    </p>
                  ) : (
                    <p className="mt-2 text-[14px] text-[#6B6898]">
                      No delivery address yet
                    </p>
                  )}
                </>
              )}

              <p className="mt-2 text-[13px] font-semibold text-[#55517F]">
                {intentLabel(order)} · {captureLabel(order.capture_method)}
              </p>

              {!walkIn ? (
                <div className="mt-3 rounded-2xl bg-[#F4F3FF] px-3 py-3">
                  <p className="text-[13px] font-bold text-[#3B3670]">
                    WhatsApp number (optional)
                  </p>
                  {savedPhone && !phoneEditing ? (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="amount text-[16px] font-bold text-[#0F0A2E]">
                        +{savedPhone}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPhoneDraft(savedPhone);
                          setPhoneEditing(true);
                          setPhoneNote(null);
                        }}
                        className="min-h-11 px-2 text-[14px] font-bold text-[#17104A] underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-col gap-2">
                      <input
                        value={phoneDraft}
                        onChange={(e) => setPhoneDraft(e.target.value)}
                        inputMode="tel"
                        autoComplete="tel"
                        aria-label="Customer WhatsApp number"
                        placeholder="0803 123 4567"
                        className={fieldClass}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void savePhone(phoneDraft)}
                          className="btn btn-secondary flex-1"
                        >
                          Save number
                        </button>
                        {canPickContacts() ? (
                          <button
                            type="button"
                            onClick={() => void pickFromContacts()}
                            className="btn btn-quiet flex-1"
                          >
                            Pick from contacts
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {phoneNote ? (
                    <p className="mt-1 text-[13px] font-semibold text-[#55517F]" role="status">
                      {phoneNote}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {pending && walkIn ? (
                <WalkInCustomerPicker
                  customers={recent}
                  disabled={busy}
                  onPick={onAttachCustomer}
                />
              ) : null}

              {pending ? (
                <p className="mt-3 rounded-2xl bg-[#FEF6DC] px-3 py-2.5 text-[14px] font-semibold text-[#7A4300]">
                  Nothing has come out of your stock or into your money yet.
                  That happens when you tap Mark as sold.
                </p>
              ) : (
                <p className="mt-3 rounded-2xl bg-[#E4F8EE] px-3 py-2.5 text-[14px] font-semibold text-[#065F46]">
                  Done. Your stock is reduced and your profit is saved.
                </p>
              )}

              {needsRestock ? (
                <p className="mt-2 text-[14px] font-semibold text-red-800" role="status">
                  Not enough in stock. Add new stock first.
                </p>
              ) : null}

              {error ? (
                <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="mt-4 flex flex-col gap-2.5">
                {pending ? (
                  <>
                    <button
                      type="button"
                      disabled={
                        busy || order.ledger_committed || unparsed || needsRestock
                      }
                      onClick={onConfirm}
                      className="btn btn-success min-h-[54px]"
                    >
                      <Check className="size-5" strokeWidth={3} aria-hidden />
                      {confirmCtaLabel(order)}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onCancel}
                      className="btn btn-quiet"
                    >
                      Cancel this order
                    </button>
                  </>
                ) : null}
                {confirmed ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || sharing}
                      onClick={onShare}
                      className="btn btn-primary min-h-[54px]"
                    >
                      <Share2 className="size-5" aria-hidden />
                      {sharing ? "Opening…" : "Send receipt on WhatsApp"}
                    </button>
                    {shareStatus ? (
                      <p
                        className={`text-[14px] font-semibold ${shareFailed ? "text-red-700" : "text-[#065F46]"}`}
                        role="status"
                      >
                        {shareStatus}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onReturn}
                      className="btn btn-quiet"
                    >
                      Customer returned this
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* History tab */}
          {activeTab === "history" && (
            <div>
              {history.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-[15px] text-[#55517F]">
                    No earlier orders from this customer yet
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[#ECEAF7]">
                  {history.map((h) => (
                    <li key={h.order_id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#55517F]">
                            {formatDateKey(h.date_key)}
                          </p>
                          <p className="mt-0.5 truncate text-[15px] font-semibold text-[#0F0A2E]">
                            {formatLines(h.items)}
                          </p>
                        </div>
                        <p className="amount shrink-0 text-[15px] font-bold text-[#065F46]">
                          {formatNaira(orderGross(h.items))}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DevShortcuts({
  busy,
  onRun,
}: {
  busy: boolean;
  onRun: (action: () => Promise<void>) => void;
}) {
  return (
    <details className="mt-8 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        Dev shortcuts
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">
        Same engine as Log inquiry. Cards land in the inbox above.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onRun(async () => {
              await createPendingOrder({
                customer_name: "Chioma",
                items: [{ product_id: SHOE_SKU, quantity: 2 }],
                capture_method: "manual",
                intent_classification: "INQUIRY",
              });
            })
          }
          className="min-h-11 rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Add pending: 2× Black Shoes (Chioma)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onRun(async () => {
              await createPendingOrder({
                customer_name: "Amaka",
                items: [{ product_id: CAKE_SKU, quantity: 1 }],
                capture_method: "manual",
                intent_classification: "INQUIRY",
              });
            })
          }
          className="min-h-11 rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Add pending: 1× Red Velvet Cake (OOS)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onRun(async () => {
              await createPendingOrder({
                customer_name: "ExpireMe",
                items: [{ product_id: SHOE_SKU, quantity: 2 }],
                capture_method: "manual",
                intent_classification: "INQUIRY",
                created_at: Date.now() - PENDING_TTL_MS - 60 * 60 * 1000,
              });
            })
          }
          className="min-h-11 rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Add 73h-old pending
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onRun(async () => {
              await expireStalePendingOrders();
            })
          }
          className="min-h-11 rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Expire stale pending
        </button>
      </div>
    </details>
  );
}

export function OrderStream() {
  const orders = useOrders();
  const skus = useSkus();
  const customers = useCustomers();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [soldName, setSoldName] = useState<string | null>(null);

  useEffect(() => {
    if (soldName === null) return;
    const t = window.setTimeout(() => setSoldName(null), 1300);
    return () => window.clearTimeout(t);
  }, [soldName]);

  const visible = useMemo(
    () => newestFirst((orders ?? []).filter(isInboxVisible)),
    [orders],
  );

  const selectedOrder = useMemo(
    () =>
      selectedOrderId
        ? (orders ?? []).find((o) => o.order_id === selectedOrderId)
        : undefined,
    [selectedOrderId, orders],
  );

  async function run(orderId: string | null, action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    if (orderId) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
    try {
      await action();
    } catch (err) {
      if (orderId) {
        setErrors((prev) => ({
          ...prev,
          [orderId]:
            err instanceof Error ? err.message : "Something went wrong",
        }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(orderId: string) {
    await run(orderId, async () => {
      const result = await commitConfirmedOrder(orderId);
      const message = formatCommitError(result, skus ?? []);
      if (message) {
        setErrors((prev) => ({ ...prev, [orderId]: message }));
      } else if (result.outcome === "committed") {
        const who = (orders ?? []).find((o) => o.order_id === orderId);
        setSoldName(who?.customer_name ?? "");
      }
    });
  }

  async function onCancel(orderId: string) {
    await run(orderId, async () => {
      await cancelOrArchiveOrder(orderId);
    });
  }

  async function onReturn(orderId: string) {
    await run(orderId, async () => {
      const result = await processReturn(orderId);
      const message = formatReturnError(result, skus ?? []);
      if (message) {
        setErrors((prev) => ({ ...prev, [orderId]: message }));
      }
    });
  }

  async function onAttachCustomer(orderId: string, customerIdValue: string) {
    await run(orderId, async () => {
      await attachCustomerToWalkInOrder(orderId, customerIdValue);
    });
  }

  function toggleCheck(orderId: string) {
    setDeleteError(null);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAll() {
    setDeleteError(null);
    if (visible.every((o) => checkedIds.has(o.order_id))) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(visible.map((o) => o.order_id)));
    }
  }

  async function onDeleteSelected() {
    if (deleting) return;
    const ids = [...checkedIds];
    const toDelete = (orders ?? []).filter((o) => ids.includes(o.order_id));
    const blocked = toDelete.filter(
      (o) => o.status === "CONFIRMED_SALE" || o.status === "REFUNDED",
    );
    if (blocked.length > 0) {
      setDeleteError("Sold and returned orders cannot be deleted.");
      return;
    }
    setDeleting(true);
    try {
      await deleteOrders(ids);
      setCheckedIds(new Set());
      setDeleteError(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  if (orders === undefined || skus === undefined || customers === undefined) {
    return (
      <section className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
        <h1 className="page-title">Order Stream</h1>
        <p className="mt-3 text-[15px] text-[#55517F]">Loading your orders…</p>
      </section>
    );
  }

  const catalog = [...skus].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
  const directory = recentCustomers(customers, orders);
  const allChecked =
    visible.length > 0 && visible.every((o) => checkedIds.has(o.order_id));
  const someChecked = visible.some((o) => checkedIds.has(o.order_id));
  const waiting = visible.filter(
    (o) => o.status === "PENDING_INQUIRY" && !o.ledger_committed,
  ).length;

  return (
    <section className="flex min-h-full flex-col px-4 pb-28 pt-5">
      <h1 className="page-title">Order Stream</h1>
      <p className="page-sub mt-0.5">
        {visible.length === 0
          ? "Your customers’ orders show up here"
          : waiting > 0
            ? `${waiting} order${waiting !== 1 ? "s" : ""} not paid yet`
            : "All your orders are sold"}
      </p>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="btn btn-primary mt-4 min-h-[54px] w-full"
      >
        <Plus className="size-5" strokeWidth={2.5} aria-hidden />
        New order
      </button>

      {visible.length === 0 ? (
        <EmptyState
          art={<InboxArt className="w-full" />}
          title="No orders yet"
          body="Share a WhatsApp chat into OnRecord, or tap the amber + button to add one."
        />
      ) : (
        <div className="card mt-5 overflow-hidden">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[34%]" />
              <col className="w-[26%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[#ECEAF7] bg-[#F7F6FE]">
                <th scope="col" className="p-0 text-center">
                  <label className="flex min-h-11 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label="Select all orders"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked && !allChecked;
                      }}
                      onChange={toggleAll}
                      className="size-5 accent-[#17104A]"
                    />
                  </label>
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-left text-[12px] font-bold text-[#55517F]"
                >
                  Customer
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-left text-[12px] font-bold text-[#55517F]"
                >
                  What they want
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-center text-[12px] font-bold text-[#55517F]"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEF9]">
              {visible.map((order, index) => {
                const isPending =
                  order.status === "PENDING_INQUIRY" && !order.ledger_committed;
                const isConfirmed =
                  order.status === "CONFIRMED_SALE" && order.ledger_committed;
                const unparsed = isPending && order.items.length === 0;
                const needsRestock =
                  isPending && !unparsed && orderNeedsRestock(order, skus);
                const gross = orderGross(order.items);
                const itemSummary = unparsed
                  ? "Needs a product"
                  : formatLines(order.items);

                const isChecked = checkedIds.has(order.order_id);

                return (
                  <tr
                    key={order.order_id}
                    onClick={() => setSelectedOrderId(order.order_id)}
                    style={{ ["--i" as string]: Math.min(index, 8) }}
                    className={`anim-card cursor-pointer transition-colors ${
                      isChecked
                        ? "bg-[#EEF0FF]"
                        : isPending
                          ? "bg-white active:bg-[#FFF8E6]"
                          : "bg-[#F3FCF8] active:bg-[#E4F8EE]"
                    }`}
                  >
                    <td
                      className="p-0 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="flex min-h-16 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          aria-label={`Select order for ${order.customer_name}`}
                          checked={isChecked}
                          onChange={() => toggleCheck(order.order_id)}
                          className="size-5 accent-[#17104A]"
                        />
                      </label>
                    </td>
                    <td className="max-w-0 overflow-hidden px-2 py-3">
                      <p className="truncate text-[15px] font-bold text-[#0F0A2E]">
                        {order.customer_name}
                      </p>
                      <span
                        className={`pill mt-1 !px-2 !text-[11.5px] ${
                          isPending ? "pill-amber" : "pill-green"
                        }`}
                      >
                        {isPending ? "Not paid yet" : "Sold"}
                      </span>
                    </td>
                    <td className="max-w-0 overflow-hidden px-2 py-3">
                      <p className="truncate text-[14px] text-[#3B3670]">
                        {itemSummary}
                      </p>
                      <p className="amount text-[15px] font-extrabold text-[#17104A]">
                        {gross > 0 ? formatNaira(gross) : "—"}
                      </p>
                    </td>
                    <td
                      className="px-1 py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {isPending ? (
                          <>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                order.ledger_committed ||
                                unparsed ||
                                needsRestock
                              }
                              onClick={() => onConfirm(order.order_id)}
                              aria-label={`Mark as sold for ${order.customer_name}`}
                              className="icon-btn bg-[#0B9467] text-white shadow-[0_4px_10px_-4px_rgba(11,148,103,0.7)]"
                            >
                              <Check
                                className="size-5"
                                strokeWidth={3}
                                aria-hidden
                              />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onCancel(order.order_id)}
                              aria-label={`Cancel order for ${order.customer_name}`}
                              className="icon-btn border border-[#DAD7EE] bg-white text-[#55517F]"
                            >
                              <X className="size-5" aria-hidden />
                            </button>
                          </>
                        ) : null}
                        {isConfirmed ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setSelectedOrderId(order.order_id)}
                            aria-label={`Send receipt to ${order.customer_name}`}
                            className="icon-btn bg-[#17104A] text-white"
                          >
                            <Share2 className="size-5" aria-hidden />
                          </button>
                        ) : null}
                        {!isPending && !isConfirmed ? (
                          <button
                            type="button"
                            onClick={() => setSelectedOrderId(order.order_id)}
                            aria-label={`View order for ${order.customer_name}`}
                            className="icon-btn border border-[#DAD7EE] bg-white text-[#55517F]"
                          >
                            <RotateCcw className="size-5" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isDev ? (
        <DevShortcuts busy={busy} onRun={(action) => run(null, action)} />
      ) : null}

      {sheetOpen ? (
        <NewInquirySheet skus={catalog} onClose={() => setSheetOpen(false)} />
      ) : null}

      {selectedOrder ? (
        <OrderDetailSheet
          order={selectedOrder}
          allOrders={orders}
          skus={skus}
          customers={customers}
          recent={directory}
          busy={busy}
          error={errors[selectedOrder.order_id] ?? null}
          onConfirm={() => onConfirm(selectedOrder.order_id)}
          onCancel={() => {
            void onCancel(selectedOrder.order_id);
            setSelectedOrderId(null);
          }}
          onReturn={() => onReturn(selectedOrder.order_id)}
          onAttachCustomer={(id) =>
            onAttachCustomer(selectedOrder.order_id, id)
          }
          onClose={() => setSelectedOrderId(null)}
        />
      ) : null}

      {soldName !== null ? (
        <div
          className="pointer-events-none absolute inset-0 z-[70] flex flex-col items-center justify-center bg-[#0F0A2E]/35"
          role="status"
          aria-live="polite"
        >
          <div className="relative flex size-28 items-center justify-center">
            <span className="anim-ring absolute inset-0 rounded-full bg-[#10B981]" />
            <span className="anim-pop flex size-24 items-center justify-center rounded-full bg-gradient-to-b from-[#14B882] to-[#0B9467] shadow-[0_12px_30px_-8px_rgba(11,148,103,0.8)]">
              <Check className="size-12 text-white" strokeWidth={3.5} aria-hidden />
            </span>
          </div>
          <p className="anim-toast mt-5 rounded-full bg-white px-5 py-2 text-[17px] font-extrabold text-[#065F46] shadow-lg">
            Sold{soldName ? ` to ${soldName}` : ""}!
          </p>
        </div>
      ) : null}

      {checkedIds.size > 0 ? (
        <div className="anim-toast absolute inset-x-0 bottom-[67px] z-20 border-t border-[#E6E3F5] bg-white px-4 shadow-[0_-8px_20px_-10px_rgba(23,16,74,0.3)]">
          <div className="flex min-h-16 items-center justify-between gap-3">
            <p className="text-[15px] font-bold text-[#0F0A2E]">
              {checkedIds.size} selected
            </p>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void onDeleteSelected()}
              className="btn btn-danger"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
          {deleteError ? (
            <p className="pb-2 text-[13px] font-semibold text-red-600" role="alert">
              {deleteError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
