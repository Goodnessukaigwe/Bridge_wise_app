"use client";

import { Plus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  LOW_STOCK_THRESHOLD,
  skuId,
  toIdToken,
  variantFromSkuId,
} from "@/lib/db/dexie";
import { RestockSheet } from "@/components/inventory/RestockSheet";
import { useOrders, useSkus } from "@/lib/db/hooks";
import {
  createSku,
  effectiveLowStockThreshold,
  sevenDayVelocityFromOrders,
  stockColorFor,
  updateSku,
} from "@/lib/db/transactions";
import type { Sku, StockColor } from "@/types/bridgewise";

const BADGE: Record<StockColor, { label: string; className: string }> = {
  GREEN: {
    label: "In stock",
    className: "bg-[#DCFCE7] text-[#166534]",
  },
  YELLOW: {
    label: "Running low",
    className: "bg-[#FEF3C7] text-[#92400E]",
  },
  RED: {
    label: "Out of stock",
    className: "bg-[#FEE2E2] text-[#991B1B]",
  },
};

const COLOR_RANK: Record<StockColor, number> = {
  RED: 0,
  YELLOW: 1,
  GREEN: 2,
};

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function colorOf(sku: Sku): StockColor {
  return stockColorFor(sku.stock_qty, effectiveLowStockThreshold(sku));
}

function pinLowStockFirst(skus: Sku[]): Sku[] {
  return [...skus].sort((a, b) => {
    const rank = COLOR_RANK[colorOf(a)] - COLOR_RANK[colorOf(b)];
    if (rank !== 0) return rank;
    return a.display_name.localeCompare(b.display_name);
  });
}

function parseNonNegativeInt(raw: string, fallback = 0): number {
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return NaN;
  return Math.trunc(value);
}

function parseMoney(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  return Number(trimmed);
}

type ProductMode = "reseller" | "maker";

type SkuFormState = {
  name: string;
  variant: string;
  productMode: ProductMode;
  cost: string;
  sell: string;
  batchCost: string;
  batchQty: string;
  threshold: string;
  initialQty: string;
};

function emptyForm(): SkuFormState {
  return {
    name: "",
    variant: "",
    productMode: "reseller",
    cost: "",
    sell: "",
    batchCost: "",
    batchQty: "",
    threshold: String(LOW_STOCK_THRESHOLD),
    initialQty: "0",
  };
}

function formFromSku(sku: Sku): SkuFormState {
  return {
    name: sku.display_name,
    variant: variantFromSkuId(sku.sku_id),
    productMode: sku.product_type === "maker" ? "maker" : "reseller",
    cost: String(sku.unit_cost_price),
    sell: String(sku.unit_selling_price),
    batchCost: sku.batch_cost != null ? String(sku.batch_cost) : "",
    batchQty: sku.batch_qty != null ? String(sku.batch_qty) : "",
    threshold: String(sku.low_stock_threshold),
    initialQty: String(sku.stock_qty),
  };
}

function SkuCard({
  sku,
  restockPace,
  onEdit,
}: {
  sku: Sku;
  restockPace: number;
  onEdit: (sku: Sku) => void;
}) {
  const color = colorOf(sku);
  const badge = BADGE[color];

  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit(sku)}
        className="w-full rounded-[14px] border border-[#E8E6F0] bg-white px-4 py-4 text-left shadow-[0_1px_4px_rgba(15,10,46,0.08)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-neutral-900">{sku.display_name}</p>
              {sku.product_type === "maker" ? (
                <span className="shrink-0 rounded-full border border-[#17104A] px-2 py-0.5 text-[10px] font-semibold text-[#17104A]">
                  MADE
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate font-mono text-xs text-neutral-500">
              {sku.sku_id}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">Qty</dt>
            <dd className="font-medium tabular-nums text-neutral-900">
              {sku.stock_qty}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Cost</dt>
            <dd className="font-medium tabular-nums text-neutral-900">
              {formatNaira(sku.unit_cost_price)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Sell</dt>
            <dd className="font-medium tabular-nums text-neutral-900">
              {formatNaira(sku.unit_selling_price)}
            </dd>
          </div>
        </dl>
        {color === "YELLOW" && restockPace >= 1 ? (
          <p className="mt-3 text-sm font-medium text-amber-900">
            Restock ~{restockPace} (7-day pace)
          </p>
        ) : null}
      </button>
    </li>
  );
}

function SkuFormSheet({
  sku,
  onClose,
}: {
  sku: Sku | "new";
  onClose: () => void;
}) {
  const creating = sku === "new";
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<SkuFormState>(() =>
    sku === "new" ? emptyForm() : formFromSku(sku),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const previewId = creating
    ? toIdToken(form.name) && toIdToken(form.variant)
      ? skuId(form.name, form.variant)
      : "—"
    : sku.sku_id;

  function setField<K extends keyof SkuFormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const isMaker = form.productMode === "maker";
  const batchCostNum = parseMoney(form.batchCost);
  const batchQtyNum = parseNonNegativeInt(form.batchQty, 0);
  const derivedUnitCost =
    isMaker && batchQtyNum > 0 ? batchCostNum / batchQtyNum : 0;
  const sellNum = parseMoney(form.sell);
  const profitPreview = isMaker ? sellNum - derivedUnitCost : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const unitCost = isMaker ? derivedUnitCost : parseMoney(form.cost);
      if (creating) {
        await createSku({
          name: form.name,
          variant: form.variant,
          unit_cost_price: unitCost,
          unit_selling_price: sellNum,
          low_stock_threshold: parseNonNegativeInt(form.threshold, LOW_STOCK_THRESHOLD),
          initial_qty: parseNonNegativeInt(form.initialQty, 0),
          product_type: form.productMode,
          batch_cost: isMaker ? batchCostNum : null,
          batch_qty: isMaker ? batchQtyNum : null,
        });
      } else {
        await updateSku({
          sku_id: sku.sku_id,
          name: form.name,
          unit_cost_price: unitCost,
          unit_selling_price: sellNum,
          low_stock_threshold: parseNonNegativeInt(form.threshold, LOW_STOCK_THRESHOLD),
          product_type: form.productMode,
          batch_cost: isMaker ? batchCostNum : null,
          batch_qty: isMaker ? batchQtyNum : null,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product");
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "min-h-11 w-full rounded-[10px] border border-[#E8E6F0] bg-white px-3 text-sm text-[#0F0A2E] outline-none focus:border-[#17104A]";

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="relative flex h-full w-full max-w-md items-end bg-neutral-900/40">
        <button
          type="button"
          className="absolute inset-0"
          aria-label="Dismiss SKU form"
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
              {creating ? "Add Product" : "Edit Product"}
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close SKU form"
              className="inline-flex size-11 items-center justify-center rounded-full text-neutral-700"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="block text-xs font-medium text-[#6B6898]">
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className={`${fieldClass} mt-1`}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs font-medium text-[#6B6898]">
            Variant
            <input
              required
              value={form.variant}
              onChange={(e) => setField("variant", e.target.value)}
              disabled={!creating}
              className={`${fieldClass} mt-1 disabled:bg-neutral-100`}
              autoComplete="off"
              placeholder="Size42, Std, 8in"
            />
          </label>
          <p className="font-mono text-[11px] text-[#9B97B8]">
            ID {previewId}
          </p>

          {/* Maker / reseller toggle */}
          <div className="rounded-[10px] border border-[#E8E6F0] p-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setField("productMode", "reseller")}
              className={`rounded-[8px] py-2 text-xs font-semibold transition-colors ${form.productMode === "reseller" ? "bg-[#17104A] text-white" : "text-[#6B6898]"}`}
            >
              I buy &amp; resell
            </button>
            <button
              type="button"
              onClick={() => setField("productMode", "maker")}
              className={`rounded-[8px] py-2 text-xs font-semibold transition-colors ${form.productMode === "maker" ? "bg-[#17104A] text-white" : "text-[#6B6898]"}`}
            >
              I make this
            </button>
          </div>

          {isMaker ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-[#6B6898]">
                  Batch cost (₦)
                  <input
                    required
                    inputMode="decimal"
                    value={form.batchCost}
                    onChange={(e) => setField("batchCost", e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="Total to make batch"
                  />
                </label>
                <label className="block text-xs font-medium text-[#6B6898]">
                  Units per batch
                  <input
                    required
                    inputMode="numeric"
                    value={form.batchQty}
                    onChange={(e) => setField("batchQty", e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="e.g. 20"
                  />
                </label>
              </div>
              {batchQtyNum > 0 && batchCostNum > 0 ? (
                <p className="text-xs text-[#6B6898]">
                  Unit cost ={" "}
                  <span className="font-semibold text-[#0F0A2E]">
                    ₦{derivedUnitCost.toFixed(2)}
                  </span>
                  {profitPreview != null && sellNum > 0 ? (
                    <>
                      {" "}· profit ={" "}
                      <span className={`font-semibold ${profitPreview >= 0 ? "text-[#10B981]" : "text-red-600"}`}>
                        ₦{profitPreview.toFixed(2)}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </>
          ) : (
            <label className="block text-xs font-medium text-[#6B6898]">
              Cost (₦)
              <input
                required
                inputMode="decimal"
                value={form.cost}
                onChange={(e) => setField("cost", e.target.value)}
                className={`${fieldClass} mt-1`}
              />
            </label>
          )}

          <label className="block text-xs font-medium text-[#6B6898]">
            Sell price (₦)
            <input
              required
              inputMode="decimal"
              value={form.sell}
              onChange={(e) => setField("sell", e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </label>
          <label className="block text-xs font-medium text-[#6B6898]">
            Low-stock threshold
            <input
              required
              inputMode="numeric"
              value={form.threshold}
              onChange={(e) => setField("threshold", e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </label>
          {creating ? (
            <label className="block text-xs font-medium text-[#6B6898]">
              Initial quantity
              <input
                required
                inputMode="numeric"
                value={form.initialQty}
                onChange={(e) => setField("initialQty", e.target.value)}
                className={`${fieldClass} mt-1`}
              />
            </label>
          ) : (
            <p className="text-sm text-[#6B6898]">
              Qty {sku.stock_qty} — changes only via Confirm, return, or restock.
            </p>
          )}
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-1 h-[54px] w-full rounded-[10px] bg-[#17104A] text-[15px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : creating ? "Save Product" : "Save changes"}
          </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function StockRoom() {
  const skus = useSkus();
  const orders = useOrders();
  const [sheet, setSheet] = useState<Sku | null | "new">(null);
  const [restockOpen, setRestockOpen] = useState(false);

  const sorted = useMemo(
    () => (skus ? pinLowStockFirst(skus) : []),
    [skus],
  );
  const paceBySku = useMemo(() => {
    const map = new Map<string, number>();
    if (!skus || !orders) return map;
    for (const sku of skus) {
      map.set(sku.sku_id, sevenDayVelocityFromOrders(sku.sku_id, orders));
    }
    return map;
  }, [skus, orders]);

  if (skus === undefined) {
    return (
      <section className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Stock Room</h1>
        <p className="mt-3 text-sm text-neutral-600">Loading stock…</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-full flex-col px-4 py-6">
      <h1 className="text-center text-[22px] font-bold text-[#0F0A2E]">
        Stock Room
      </h1>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setSheet("new")}
          className="flex h-[54px] w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#17104A] text-[15px] font-semibold text-white"
        >
          <Plus className="size-4" strokeWidth={2.5} aria-hidden />
          Add Product
        </button>
        <button
          type="button"
          onClick={() => setRestockOpen(true)}
          disabled={sorted.length === 0}
          className="h-[54px] w-full rounded-[10px] border-[1.5px] border-[#17104A] bg-white text-[15px] font-semibold text-[#17104A] disabled:opacity-50"
        >
          Restock Items
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <p className="text-[18px] font-semibold text-[#0F0A2E]">
            No products yet
          </p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-[#6B6898]">
            Add a product to start tracking stock.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {sorted.map((sku) => (
            <SkuCard
              key={sku.sku_id}
              sku={sku}
              restockPace={paceBySku.get(sku.sku_id) ?? 0}
              onEdit={setSheet}
            />
          ))}
        </ul>
      )}

      {sheet ? (
        <SkuFormSheet
          sku={sheet}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {restockOpen ? (
        <RestockSheet
          skus={sorted}
          onClose={() => setRestockOpen(false)}
        />
      ) : null}
    </section>
  );
}
