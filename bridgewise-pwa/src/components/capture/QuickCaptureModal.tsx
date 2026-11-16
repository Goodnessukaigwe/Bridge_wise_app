"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  captureChatText,
  type CaptureRestockPending,
} from "@/lib/ai/captureText";
import { RestockSheet } from "@/components/inventory/RestockSheet";
import { useToast } from "@/components/shell/Toast";
import { useSkus } from "@/lib/db/hooks";

const fieldClass =
  "min-h-28 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900";

export function QuickCaptureModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (kind: "order" | "expense" | "restock") => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { showToast, hideToast } = useToast();
  const skus = useSkus();
  const [text, setText] = useState("");
  const [showPaste, setShowPaste] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restockPending, setRestockPending] =
    useState<CaptureRestockPending | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setText("");
      setShowPaste(true);
      setError(null);
      setBusy(false);
      setRestockPending(null);
    }
  }, [open]);

  async function readClipboard() {
    setError(null);
    if (!navigator.clipboard?.readText) {
      setShowPaste(true);
      setError("Clipboard unavailable. Paste the chat below.");
      return;
    }
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        setShowPaste(true);
        setError("Clipboard is empty. Paste the chat below.");
        return;
      }
      setText(clip);
      setShowPaste(true);
    } catch {
      setShowPaste(true);
      setError("Clipboard blocked. Paste the chat below.");
    }
  }

  function captureBusyLabel() {
    return typeof navigator !== "undefined" && navigator.onLine
      ? "Parsing…"
      : "Saving…";
  }

  async function save() {
    const raw = text.trim();
    if (!raw) {
      const message = "Paste a chat, or type Fuel 5k / Restocked 20 Ankara.";
      setShowPaste(true);
      setError(message);
      showToast("error", message);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    showToast("busy", captureBusyLabel());
    try {
      const outcome = await captureChatText({
        raw_text: raw,
        capture_method: "clipboard",
      });
      if (!outcome.ok) {
        if (outcome.kind === "needs_restock_sheet") {
          hideToast();
          setRestockPending(outcome.pending);
          return;
        }
        setError(outcome.message);
        showToast("error", outcome.message);
        return;
      }
      hideToast();
      onSaved?.(outcome.kind);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setError(message);
      showToast("error", message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-neutral-900/40">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Dismiss capture"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[85%] w-full overflow-y-auto rounded-t-2xl border-t border-neutral-200 bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-neutral-900">
            Quick Capture
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close capture"
            className="inline-flex size-11 items-center justify-center rounded-full text-neutral-700"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-neutral-600">
          Paste a WhatsApp chat, or type Fuel 5k / Restocked 20 Ankara. Sales
          stay pending until Confirm Sale.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void readClipboard()}
            disabled={busy}
            className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 disabled:opacity-50"
          >
            Read clipboard
          </button>
          {showPaste ? (
            <label className="block text-xs font-medium text-neutral-600">
              Chat or note
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={`${fieldClass} mt-1`}
                placeholder="Fuel 5k, nylon 3k — or a WhatsApp chat"
                autoComplete="off"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setShowPaste(true)}
              className="text-left text-sm font-medium text-neutral-700 underline-offset-2 hover:underline"
            >
              Paste instead
            </button>
          )}
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="min-h-11 rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? typeof navigator !== "undefined" && navigator.onLine
                ? "Parsing…"
                : "Saving…"
              : "Save"}
          </button>
        </div>
      </div>
      {restockPending ? (
        <RestockSheet
          skus={skus ?? []}
          initialSkuId={restockPending.sku_id ?? ""}
          initialQty={String(restockPending.qty)}
          initialTotal={
            restockPending.total_cost > 0
              ? String(restockPending.total_cost)
              : ""
          }
          productHint={restockPending.product_name}
          onClose={() => setRestockPending(null)}
          onSaved={() => {
            onSaved?.("restock");
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
