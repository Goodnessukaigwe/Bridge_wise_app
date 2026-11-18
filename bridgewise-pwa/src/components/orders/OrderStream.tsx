"use client";

import { Check, Plus, RotateCcw, Share2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { isWalkInName } from "@/lib/ai/identity";
import { attachCustomerToWalkInOrder } from "@/lib/db/customers";
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

const fieldClass =
  "min-h-11 w-full rounded-[10px] border border-[#E8E6F0] bg-white px-3 text-sm text-[#0F0A2E] outline-none focus:border-[#17104A]";

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

function formatCommitError(result: CommitOrderResult): string | null {
  if (result.outcome !== "aborted") return null;
  if (result.reason === "empty_items") {
    return "Unparsed chat — Confirm disabled until a product is matched.";
  }
  const sku = result.sku_id ? ` (${result.sku_id})` : "";
  if (result.reason === "out_of_stock") {
    return `Out of stock${sku}. Sale not confirmed — nothing deducted.`;
  }
  return `SKU missing${sku}. Sale not confirmed — nothing deducted.`;
}

function captureLabel(method: CaptureMethod): string {
  switch (method) {
    case "clipboard":
      return "Clipboard";
    case "whatsapp_share_sheet":
      return "WhatsApp share";
    case "manual":
      return "Manual";
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

function formatReturnError(result: ReturnOrderResult): string | null {
  if (result.outcome !== "aborted") return null;
  const sku = result.sku_id ? ` (${result.sku_id})` : "";
  return `Cannot return — SKU missing${sku}.`;
}

function intentLabel(order: Order): string {
  if (
    order.intent_classification === "HIGH_PURCHASE_INTENT" ||
    order.suggested_status === "READY_TO_CONFIRM"
  ) {
    return "High purchase intent";
  }
  return "Inquiry";
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
    ? "Confirm & Deduct Stock"
    : "Tap to Confirm Sale";
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
        className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 disabled:opacity-50"
      >
        Attach {recent.name}
        {recent.saved_addresses[0] ? ` · ${recent.saved_addresses[0]}` : ""}
      </button>
      {customers.length > 1 ? (
        <label className="block text-xs font-medium text-neutral-600">
          Or pick another
          <select
            className={`${fieldClass} mt-1`}
            value=""
            disabled={disabled}
            aria-label="Attach a saved customer to this walk-in"
            onChange={(event) => {
              const id = event.target.value;
              if (id) onPick(id);
            }}
          >
            <option value="">Recent customers</option>
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
      setError("Customer name is required");
      return;
    }
    if (!skuId) {
      setError("Pick a SKU from Stock Room");
      return;
    }
    if (!Number.isInteger(parsedQty) || parsedQty < 1) {
      setError("Quantity must be a whole number of 1 or more");
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
      setError(err instanceof Error ? err.message : "Could not log inquiry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="relative flex h-full w-full max-w-md items-end bg-neutral-900/40">
        <button
          type="button"
          className="absolute inset-0"
          aria-label="Dismiss inquiry form"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative max-h-[85%] w-full overflow-y-auto rounded-t-2xl border-t border-neutral-200 bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 id={titleId} className="text-base font-semibold text-[#0F0A2E]">
              New Order
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close inquiry form"
              className="inline-flex size-11 items-center justify-center rounded-full text-neutral-700"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <p className="mb-3 text-sm leading-relaxed text-neutral-600">
            Saves a pending card only. Stock and ₦ stay untouched until Confirm
            Sale.
          </p>
          {skus.length === 0 ? (
            <p className="text-sm text-neutral-600">
              Add a SKU in Stock Room before logging an inquiry.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label className="block text-xs font-medium text-neutral-600">
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
              <label className="block text-xs font-medium text-neutral-600">
                Delivery address
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={`${fieldClass} mt-1`}
                  autoComplete="street-address"
                  placeholder="Lekki Phase 1"
                />
              </label>
              <label className="block text-xs font-medium text-neutral-600">
                SKU
                <select
                  required
                  value={skuId}
                  onChange={(e) => setSkuId(e.target.value)}
                  className={`${fieldClass} mt-1`}
                >
                  {skus.map((sku) => (
                    <option key={sku.sku_id} value={sku.sku_id}>
                      {sku.display_name} · {sku.stock_qty} on hand ·{" "}
                      {formatNaira(sku.unit_selling_price)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-neutral-600">
                Quantity
                <input
                  required
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={`${fieldClass} mt-1`}
                />
              </label>
              {shortOnHand ? (
                <p className="text-xs leading-relaxed text-amber-800">
                  On-hand is {selected?.stock_qty}. You can still log the
                  inquiry — Confirm Sale will refuse if stock is short.
                </p>
              ) : null}
              {error ? (
                <p className="text-sm text-red-700" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="mt-1 min-h-11 rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save inquiry"}
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

  async function onShare() {
    if (sharing) return;
    setSharing(true);
    setShareStatus(null);
    setShareFailed(false);
    try {
      const result = await shareReceipt(order);
      if (result.status === "shared") setShareStatus("Shared");
      else if (result.status === "copied") setShareStatus("Copied");
      else if (result.status === "cancelled") setShareStatus("Share cancelled");
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
      <div className="relative flex h-full w-full max-w-md items-end bg-neutral-900/40">
        <button
          type="button"
          className="absolute inset-0"
          aria-label="Close order detail"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative max-h-[85%] w-full overflow-y-auto rounded-t-2xl border-t border-neutral-200 bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-lg"
        >
          {/* Sheet header */}
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="truncate text-base font-semibold text-neutral-900"
              >
                {order.customer_name}
              </h2>
              <p className="font-mono text-[11px] text-neutral-500">
                {order.order_id}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-700"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {/* Tab switcher */}
          <div className="mb-4 flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition-colors ${
                activeTab === "details"
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500"
              }`}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition-colors ${
                activeTab === "history"
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500"
              }`}
            >
              History{history.length > 0 ? ` (${history.length})` : ""}
            </button>
          </div>

          {/* Details tab */}
          {activeTab === "details" && (
            <div>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  pending
                    ? "bg-amber-200 text-amber-950"
                    : "bg-emerald-200 text-emerald-950"
                }`}
              >
                {pending ? "PENDING INQUIRY" : "CONFIRMED SALE"}
              </span>

              {unparsed ? (
                <>
                  {rawSnippet ? (
                    <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm text-neutral-800">
                      {rawSnippet}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm font-medium text-amber-950">
                    Unparsed chat — Confirm disabled until a product is matched.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm font-medium text-neutral-900">
                    {formatLines(order.items)}
                  </p>
                  <p className="mt-0.5 text-sm tabular-nums text-neutral-700">
                    {formatNaira(gross)}
                  </p>
                  {rawSnippet ? (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-neutral-700">
                      {rawSnippet}
                    </p>
                  ) : snippet ? (
                    <p className="mt-2 line-clamp-2 text-sm text-neutral-700">
                      {snippet}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-neutral-500">
                      No delivery address
                    </p>
                  )}
                </>
              )}

              <p className="mt-2 text-xs font-medium text-neutral-600">
                Intent: {intentLabel(order)} · {captureLabel(order.capture_method)}
              </p>

              {pending && walkIn ? (
                <WalkInCustomerPicker
                  customers={recent}
                  disabled={busy}
                  onPick={onAttachCustomer}
                />
              ) : null}

              {pending ? (
                <p className="mt-3 text-sm font-medium text-amber-950">
                  0 stock deducted. Pocket unchanged until Confirm Sale.
                </p>
              ) : (
                <p className="mt-3 text-sm font-medium text-emerald-950">
                  Stock Deducted • Profit Logged
                </p>
              )}

              {needsRestock ? (
                <p className="mt-2 text-sm font-medium text-red-800" role="status">
                  out of stock — restock first
                </p>
              ) : null}

              {error ? (
                <p className="mt-2 text-sm text-red-700" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {pending ? (
                  <>
                    <button
                      type="button"
                      disabled={
                        busy || order.ledger_committed || unparsed || needsRestock
                      }
                      onClick={onConfirm}
                      className="min-h-11 rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {confirmCtaLabel(order)}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onCancel}
                      className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 disabled:opacity-50"
                    >
                      Cancel / Archive
                    </button>
                  </>
                ) : null}
                {confirmed ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || sharing}
                      onClick={onShare}
                      className="min-h-11 rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {sharing ? "Sharing…" : "Share Receipt"}
                    </button>
                    {shareStatus ? (
                      <p
                        className={`text-sm ${shareFailed ? "text-red-700" : "text-emerald-950"}`}
                        role="status"
                      >
                        {shareStatus}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onReturn}
                      className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 disabled:opacity-50"
                    >
                      Log return
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
                  <p className="text-sm text-neutral-500">No previous orders</p>
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {history.map((h) => (
                    <li key={h.order_id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-500">
                            {formatDateKey(h.date_key)}
                          </p>
                          <p className="mt-0.5 truncate text-sm font-medium text-neutral-900">
                            {formatLines(h.items)}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-800">
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
      const message = formatCommitError(result);
      if (message) {
        setErrors((prev) => ({ ...prev, [orderId]: message }));
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
      const message = formatReturnError(result);
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
      setDeleteError("Confirmed and refunded orders cannot be deleted.");
      return;
    }
    setDeleting(true);
    try {
      await deleteOrders(ids);
      setCheckedIds(new Set());
      setDeleteError(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  if (orders === undefined || skus === undefined || customers === undefined) {
    return (
      <section className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Order Stream</h1>
        <p className="mt-3 text-sm text-neutral-600">Loading orders…</p>
      </section>
    );
  }

  const catalog = [...skus].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
  const directory = recentCustomers(customers, orders);

  return (
    <section className="flex min-h-full flex-col px-4 py-6">
      <h1 className="text-center text-[22px] font-bold text-[#0F0A2E]">
        Order Stream
      </h1>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="mt-4 flex h-[54px] w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#17104A] text-[15px] font-semibold text-white"
      >
        <Plus className="size-4" strokeWidth={2.5} aria-hidden />
        New Order
      </button>

      {visible.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <p className="max-w-xs text-[18px] font-semibold leading-snug text-[#0F0A2E]">
            No orders yet
          </p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-[#6B6898]">
            Share a WhatsApp chat into OnRecord, or tap the amber button below
            to paste one.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[20%]" />
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col className="w-[13%]" />
              <col className="w-[24%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-neutral-200">
                <th scope="col" className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all orders"
                    checked={visible.length > 0 && visible.every((o) => checkedIds.has(o.order_id))}
                    ref={(el) => {
                      if (el) el.indeterminate = visible.some((o) => checkedIds.has(o.order_id)) && !visible.every((o) => checkedIds.has(o.order_id));
                    }}
                    onChange={toggleAll}
                    className="accent-[#17104A]"
                  />
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500"
                >
                  Customer
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500"
                >
                  Items
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500"
                >
                  ₦
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visible.map((order) => {
                const isPending =
                  order.status === "PENDING_INQUIRY" && !order.ledger_committed;
                const isConfirmed =
                  order.status === "CONFIRMED_SALE" && order.ledger_committed;
                const unparsed = isPending && order.items.length === 0;
                const needsRestock =
                  isPending && !unparsed && orderNeedsRestock(order, skus);
                const gross = orderGross(order.items);
                const itemSummary = unparsed
                  ? "(unparsed)"
                  : formatLines(order.items);

                const isChecked = checkedIds.has(order.order_id);

                return (
                  <tr
                    key={order.order_id}
                    onClick={() => setSelectedOrderId(order.order_id)}
                    className={`cursor-pointer transition-colors ${
                      isChecked
                        ? "bg-[#EEF0FF]"
                        : isPending
                          ? "bg-white hover:bg-amber-50"
                          : "bg-[#F0FDF8] hover:bg-emerald-50"
                    }`}
                  >
                    <td
                      className="px-2 py-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select order for ${order.customer_name}`}
                        checked={isChecked}
                        onChange={() => toggleCheck(order.order_id)}
                        className="accent-[#17104A]"
                      />
                    </td>
                    <td
                      className={`max-w-0 overflow-hidden border-l-4 px-3 py-3 ${
                        isPending
                          ? "border-l-[#F59E0B]"
                          : "border-l-[#10B981]"
                      }`}
                    >
                      <p className="truncate font-semibold text-[#0F0A2E]">
                        {order.customer_name}
                      </p>
                    </td>
                    <td className="max-w-0 overflow-hidden px-3 py-3">
                      <p className="truncate text-neutral-700">{itemSummary}</p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-700">
                      {gross > 0 ? formatNaira(gross) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`text-xs font-semibold ${
                          isPending ? "text-amber-800" : "text-emerald-800"
                        }`}
                      >
                        {isPending ? "Pending" : "Received"}
                      </span>
                    </td>
                    <td
                      className="px-3 py-3"
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
                              aria-label={`Confirm sale for ${order.customer_name}`}
                              className="inline-flex size-9 items-center justify-center rounded-lg bg-neutral-900 text-white disabled:opacity-40"
                            >
                              <Check
                                className="size-4"
                                strokeWidth={2.5}
                                aria-hidden
                              />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onCancel(order.order_id)}
                              aria-label={`Cancel order for ${order.customer_name}`}
                              className="inline-flex size-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 disabled:opacity-40"
                            >
                              <X className="size-4" aria-hidden />
                            </button>
                          </>
                        ) : null}
                        {isConfirmed ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setSelectedOrderId(order.order_id)}
                            aria-label={`Share receipt for ${order.customer_name}`}
                            className="inline-flex size-9 items-center justify-center rounded-lg bg-neutral-900 text-white disabled:opacity-40"
                          >
                            <Share2 className="size-4" aria-hidden />
                          </button>
                        ) : null}
                        {!isPending && !isConfirmed ? (
                          <button
                            type="button"
                            onClick={() => setSelectedOrderId(order.order_id)}
                            aria-label={`View order for ${order.customer_name}`}
                            className="inline-flex size-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700"
                          >
                            <RotateCcw className="size-4" aria-hidden />
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

      {checkedIds.size > 0 ? (
        <div className="fixed bottom-14 inset-x-0 z-20 flex justify-center">
          <div className="w-full max-w-md border-t border-[#E8E6F0] bg-white px-4">
            <div className="flex h-14 items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#0F0A2E]">
                {checkedIds.size} selected
              </p>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void onDeleteSelected()}
                className="rounded-[10px] bg-[#EF4444] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
            {deleteError ? (
              <p className="pb-2 text-xs font-medium text-[#EF4444]" role="alert">
                {deleteError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
