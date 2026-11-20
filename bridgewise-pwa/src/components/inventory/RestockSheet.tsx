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

const fieldClass = "field";

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
        throw new Error("Please pick a product");
      }
      if (isMaker) {
        const bc = parseMoney(batchCost);
        const bq = parsePositiveInt(batchQty);
        if (!Number.isFinite(bc) || bc <= 0) throw new Error("What the batch cost you must be more than ₦0");
        if (!Number.isInteger(bq) || bq < 1) throw new Error("Items in this batch must be 1 or more");
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
          throw new Error("How many came in must be a whole number, 1 or more");
        }
        const total_cost = parseMoney(total);
        await commitRestock({ sku_id: skuId, qty: units, total_cost });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the stock. Please try again.");
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
          <div className="mb-3 flex items-center justify-between">
            <h2 id={titleId} className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
              Add new stock
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
          {productHint ? (
            <p className="mb-3 rounded-xl bg-[#FEF0C7] px-3 py-2 text-[14px] font-semibold text-[#7A4300]">
              We could not match &ldquo;{productHint}&rdquo;. Please pick the product.
            </p>
          ) : null}
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="label">
              Product
              <select
                required
                value={skuId}
                onChange={(e) => setSkuId(e.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="">Choose a product</option>
                {skus.map((sku) => (
                  <option key={sku.sku_id} value={sku.sku_id}>
                    {sku.display_name} · {sku.stock_qty} left
                    {sku.product_type === "maker" ? " · Made by me" : ""}
                  </option>
                ))}
              </select>
            </label>
            {isMaker ? (
              <>
                <label className="label">
                  What the batch cost you (₦)
                  <input
                    required
                    inputMode="decimal"
                    value={batchCost}
                    onChange={(e) => setBatchCost(e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="Total spent on this batch"
                  />
                </label>
                <label className="label">
                  Items in this batch
                  <input
                    required
                    inputMode="numeric"
                    value={batchQty}
                    onChange={(e) => setBatchQty(e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="How many this batch makes"
                  />
                </label>
                {batchCost && batchQty && Number(batchQty) > 0 ? (
                  <p className="hint">
                    Each one cost you{" "}
                    <span className="font-semibold text-[#0F0A2E]">
                      ₦{(Number(batchCost) / Number(batchQty)).toFixed(2)}
                    </span>
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <label className="label">
                  How many came in?
                  <input
                    required
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className={`${fieldClass} mt-1`}
                  />
                </label>
                <label className="label">
                  Total you paid (₦)
                  <input
                    inputMode="decimal"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    className={`${fieldClass} mt-1`}
                    placeholder="Put 0 if you are not sure"
                  />
                </label>
              </>
            )}
            {error ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || skus.length === 0}
              className="btn btn-primary mt-1 min-h-[54px]"
            >
              {busy ? "Saving…" : "Save new stock"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
