"use client";

import { PackagePlus, Plus, X } from "lucide-react";
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
  variantFromSkuId,
} from "@/lib/db/dexie";
import { ShelfArt, EmptyState } from "@/components/ui/Illustrations";
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
    className: "pill-green",
  },
  YELLOW: {
    label: "Running low",
    className: "pill-orange",
  },
  RED: {
    label: "Out of stock",
    className: "pill-red",
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
  index,
  onEdit,
}: {
  sku: Sku;
  restockPace: number;
  index: number;
  onEdit: (sku: Sku) => void;
}) {
  const color = colorOf(sku);
  const badge = BADGE[color];

  const accent =
    color === "GREEN"
      ? "bg-[#10B981]"
      : color === "YELLOW"
        ? "bg-[#F97316]"
        : "bg-[#EF4444]";
  const typeLabel = variantFromSkuId(sku.sku_id);

  return (
    <li className="anim-card" style={{ ["--i" as string]: Math.min(index, 8) }}>
      <button
        type="button"
        onClick={() => onEdit(sku)}
        className="card relative w-full overflow-hidden py-4 pl-5 pr-4 text-left transition-transform active:scale-[0.985]"
      >
        <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${accent}`} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[17px] font-bold leading-snug text-[#0F0A2E]">{sku.display_name}</p>
              {sku.product_type === "maker" ? (
                <span className="pill pill-indigo shrink-0">Made by me</span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-[#55517F]">
              Type: {typeLabel}
            </p>
          </div>
          <span
            className={`pill shrink-0 ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-[#F4F3FF] px-3 py-2.5 text-sm">
          <div>
            <dt className="text-xs font-semibold text-[#55517F]">In stock</dt>
            <dd className="text-[17px] font-bold tabular-nums text-[#0F0A2E]">
              {sku.stock_qty}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[#55517F]">Cost you</dt>
            <dd className="text-[15px] font-bold tabular-nums text-[#0F0A2E]">
              {formatNaira(sku.unit_cost_price)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[#55517F]">You sell at</dt>
            <dd className="text-[15px] font-bold tabular-nums text-[#0F0A2E]">
              {formatNaira(sku.unit_selling_price)}
            </dd>
          </div>
        </dl>
        {color === "YELLOW" && restockPace >= 1 ? (
          <p className="mt-3 text-[14px] font-semibold text-[#9A3412]">
            Add about {restockPace} more. This is how fast it sold this week.
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
      setError(err instanceof Error ? err.message : "Could not save this product. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const fieldClass = "field";

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
          <div className="mb-3 flex items-center justify-between">
            <h2 id={titleId} className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
              {creating ? "Add a product" : "Edit product"}
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
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="label">
            Product name
            <input
              required
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className={`${fieldClass} mt-1`}
              autoComplete="off"
            />
          </label>
          <label className="label">
            Type (for example size or colour)
            <input
              required
              value={form.variant}
              onChange={(e) => setField("variant", e.target.value)}
              disabled={!creating}
              className={`${fieldClass} mt-1 `}
              autoComplete="off"
              placeholder="Size 42, Red, 8 inch"
            />
          </label>

          {/* Maker / reseller toggle */}
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[#F1F0F8] p-1">
            <button
              type="button"
              onClick={() => setField("productMode", "reseller")}
              className={`min-h-11 rounded-xl py-2 text-[14px] font-bold transition-colors ${form.productMode === "reseller" ? "bg-[#17104A] text-white shadow-sm" : "text-[#55517F]"}`}
            >
              I buy &amp; resell
            </button>
            <button
              type="button"
              onClick={() => setField("productMode", "maker")}
              className={`min-h-11 rounded-xl py-2 text-[14px] font-bold transition-colors ${form.productMode === "maker" ? "bg-[#17104A] text-white shadow-sm" : "text-[#55517F]"}`}
            >
              I make this
            </button>
          </div>

          {isMaker ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="label">
                  What the batch cost you (₦)
                  <input
                    required
                    inputMode="decimal"
                    value={form.batchCost}
                    onChange={(e) => setField("batchCost", e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="Total spent"
                  />
                </label>
                <label className="label">
                  Items in this batch
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
                <p className="hint">
                  Each one costs you{" "}
                  <span className="font-semibold text-[#0F0A2E]">
                    ₦{derivedUnitCost.toFixed(2)}
                  </span>
                  {profitPreview != null && sellNum > 0 ? (
                    <>
                      {" "}· you make{" "}
                      <span className={`font-semibold ${profitPreview >= 0 ? "text-[#10B981]" : "text-red-600"}`}>
                        ₦{profitPreview.toFixed(2)}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </>
          ) : (
            <label className="label">
              What it cost you (per item) (₦)
              <input
                required
                inputMode="decimal"
                value={form.cost}
                onChange={(e) => setField("cost", e.target.value)}
                className={`${fieldClass} mt-1`}
              />
            </label>
          )}

          <label className="label">
            Your selling price (₦)
            <input
              required
              inputMode="decimal"
              value={form.sell}
              onChange={(e) => setField("sell", e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </label>
          <label className="label">
            Warn me when stock gets to
            <input
              required
              inputMode="numeric"
              value={form.threshold}
              onChange={(e) => setField("threshold", e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </label>
          {creating ? (
            <label className="label">
              How many do you have now?
              <input
                required
                inputMode="numeric"
                value={form.initialQty}
                onChange={(e) => setField("initialQty", e.target.value)}
                className={`${fieldClass} mt-1`}
              />
            </label>
          ) : (
            <p className="hint">
              You have {sku.stock_qty} in stock. This number changes when you mark a sale, log a return or add new stock.
            </p>
          )}
          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary mt-1 min-h-[54px] w-full"
          >
            {busy ? "Saving…" : creating ? "Save product" : "Save changes"}
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
        <h1 className="page-title">Stock Room</h1>
        <p className="mt-3 text-[15px] text-[#55517F]">Loading your stock…</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-full flex-col px-4 py-6">
      <h1 className="page-title">Stock Room</h1>
      <p className="page-sub mt-0.5">What you have on your shelf</p>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => setSheet("new")}
          className="btn btn-primary min-h-[54px] !px-3 whitespace-nowrap"
        >
          <Plus className="size-5" strokeWidth={2.5} aria-hidden />
          Add product
        </button>
        <button
          type="button"
          onClick={() => setRestockOpen(true)}
          disabled={sorted.length === 0}
          className="btn btn-secondary min-h-[54px] !px-3 whitespace-nowrap"
        >
          <PackagePlus className="size-5" aria-hidden />
          Add new stock
        </button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          art={<ShelfArt className="w-full" />}
          title="Your shelf is empty"
          body="Add your first product and we will keep count of your stock for you."
        />
      ) : (
        <ul className="mt-6 space-y-3">
          {sorted.map((sku, index) => (
            <SkuCard
              key={sku.sku_id}
              index={index}
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
