"use client";

import { ClipboardPaste, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  captureChatText,
  type CaptureRestockPending,
} from "@/lib/ai/captureText";
import { RestockSheet } from "@/components/inventory/RestockSheet";
import { useToast } from "@/components/shell/Toast";
import { useSkus } from "@/lib/db/hooks";

const fieldClass = "field min-h-32 py-3";

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
      setError("Your phone will not let us read what you copied. Please paste the chat below.");
      return;
    }
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        setShowPaste(true);
        setError("Nothing copied yet. Please paste the chat below.");
        return;
      }
      setText(clip);
      setShowPaste(true);
    } catch {
      setShowPaste(true);
      setError("Your phone blocked that. Please paste the chat below.");
    }
  }

  function captureBusyLabel() {
    return typeof navigator !== "undefined" && navigator.onLine
      ? "Reading your chat…"
      : "Saving…";
  }

  async function save() {
    const raw = text.trim();
    if (!raw) {
      const message = "Paste a chat, or type something like “Fuel 5k” or “Restocked 20 Ankara”.";
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
      const message = err instanceof Error ? err.message : "Could not save. Please try again.";
      setError(message);
      showToast("error", message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="sheet-backdrop absolute inset-0 z-50 flex items-end">
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
        className="sheet-panel relative max-h-[88%] w-full overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="sheet-grab" />
        <div className="mb-2 flex items-center justify-between">
          <h2 id={titleId} className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
            Add from a chat or note
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
          Paste a WhatsApp chat, or type something like “Fuel 5k” or
          “Restocked 20 Ankara”. Sales stay as <b>Not paid yet</b> until you
          tap <b>Mark as sold</b>.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void readClipboard()}
            disabled={busy}
            className="btn btn-quiet"
          >
            <ClipboardPaste className="size-5" aria-hidden />
            Paste what I copied
          </button>
          {showPaste ? (
            <label className="label">
              Chat or note
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={`${fieldClass} mt-1`}
                placeholder="Fuel 5k, nylon 3k — or paste a WhatsApp chat"
                autoComplete="off"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setShowPaste(true)}
              className="min-h-11 text-left text-[15px] font-semibold text-[#3B3670] underline underline-offset-2"
            >
              Paste instead
            </button>
          )}
          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="btn btn-primary"
          >
            {busy
              ? typeof navigator !== "undefined" && navigator.onLine
                ? "Reading your chat…"
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
