"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { commitRestock } from "@/lib/db/transactions";
import type { Sku } from "@/types/bridgewise";

function parsePositiveInt(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return NaN;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return NaN;
  return Math.trunc(value);
}

function parseMoney(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  return Number(trimmed);
}

const fieldClass =
  "min-h-11 w-full rounded-[10px] border border-[#E8E6F0] bg-white px-3 text-sm text-[#0F0A2E] focus:border-[#17104A] outline-none";

export function RestockSheet({
  skus,
  initialSkuId = "",
  initialQty = "",
  initialTotal = "",
  productHint,
  onClose,
  onSaved,
}: {
  skus: Sku[];
  initialSkuId?: string;
  initialQty?: string;
  initialTotal?: string;
  productHint?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [skuId, setSkuId] = useState(initialSkuId);
  const [qty, setQty] = useState(initialQty);
  const [total, setTotal] = useState(initialTotal);
  const [batchCost, setBatchCost] = useState("");
  const [batchQty, setBatchQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedSku = skus.find((s) => s.sku_id === skuId) ?? null;
  const isMaker = selectedSku?.product_type === "maker";

  // Pre-fill batch fields from SKU defaults when switching to a maker SKU
  useEffect(() => {
    if (isMaker && selectedSku) {
      setBatchCost(selectedSku.batch_cost != null ? String(selectedSku.batch_cost) : "");
      setBatchQty(selectedSku.batch_qty != null ? String(selectedSku.batch_qty) : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId]);

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
    setBusy(true);
    setError(null);
    try {
      if (!skuId) {
        throw new Error("Pick a product");
      }
      if (isMaker) {
        const bc = parseMoney(batchCost);
        const bq = parsePositiveInt(batchQty);
        if (!Number.isFinite(bc) || bc <= 0) throw new Error("Batch cost must be more than 0");
        if (!Number.isInteger(bq) || bq < 1) throw new Error("Units per batch must be 1 or more");
        await commitRestock({
          sku_id: skuId,
          qty: bq,
          total_cost: bc,
          batch_cost: bc,
          batch_qty: bq,
        });
      } else {
        const units = parsePositiveInt(qty);
        if (!Number.isInteger(units) || units < 1) {
          throw new Error("Qty must be a whole number of 1 or more");
        }
        const total_cost = parseMoney(total);
        await commitRestock({ sku_id: skuId, qty: units, total_cost });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restock");
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
          aria-label="Dismiss restock form"
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
              Restock Items
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close restock form"
              className="inline-flex size-11 items-center justify-center rounded-full text-[#6B6898]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {productHint ? (
            <p className="mb-3 text-sm text-amber-800">
              Couldn’t match "{productHint}". Pick a product.
            </p>
          ) : null}
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="block text-xs font-medium text-[#6B6898]">
              Product
              <select
                required
                value={skuId}
                onChange={(e) => setSkuId(e.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="">Select product</option>
                {skus.map((sku) => (
                  <option key={sku.sku_id} value={sku.sku_id}>
                    {sku.display_name} · qty {sku.stock_qty}
                    {sku.product_type === "maker" ? " · MADE" : ""}
                  </option>
                ))}
              </select>
            </label>
            {isMaker ? (
              <>
                <label className="block text-xs font-medium text-[#6B6898]">
                  Batch cost (₦)
                  <input
                    required
                    inputMode="decimal"
                    value={batchCost}
                    onChange={(e) => setBatchCost(e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="Total cost to make this batch"
                  />
                </label>
                <label className="block text-xs font-medium text-[#6B6898]">
                  Units per batch
                  <input
                    required
                    inputMode="numeric"
                    value={batchQty}
                    onChange={(e) => setBatchQty(e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="How many units this batch makes"
                  />
                </label>
                {batchCost && batchQty && Number(batchQty) > 0 ? (
                  <p className="text-xs text-[#6B6898]">
                    Unit cost ={" "}
                    <span className="font-semibold text-[#0F0A2E]">
                      ₦{(Number(batchCost) / Number(batchQty)).toFixed(2)}
                    </span>
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <label className="block text-xs font-medium text-[#6B6898]">
                  Qty
                  <input
                    required
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className={`${fieldClass} mt-1`}
                  />
                </label>
                <label className="block text-xs font-medium text-[#6B6898]">
                  Total (₦)
                  <input
                    inputMode="decimal"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="0 if unknown"
                  />
                </label>
              </>
            )}
            {error ? (
              <p className="text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || skus.length === 0}
              className="mt-1 flex min-h-[54px] items-center justify-center rounded-[12px] bg-[#17104A] px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save restock"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
