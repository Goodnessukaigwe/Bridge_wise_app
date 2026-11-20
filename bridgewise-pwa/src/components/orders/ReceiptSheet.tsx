"use client";

import { Download, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { BusinessForm } from "@/components/shell/BusinessSheet";
import { loadBusiness, type Business } from "@/lib/business";
import { db } from "@/lib/db/dexie";
import { friendlyMessage } from "@/lib/receipt/helpers";
import { formatPhoneDisplay, normalisePhone, openLink, whatsappUrl } from "@/lib/whatsapp";
import type { Order } from "@/types/bridgewise";

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Receipt sender. The PDF is built as soon as the sheet opens and kept in
 * memory so the Send button can call navigator.share directly inside the tap
 * (Safari is strict about that). Nothing here writes to the database.
 */
export function ReceiptSheet({
  order,
  phone,
  onClose,
}: {
  order: Order;
  phone?: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const waPhone = normalisePhone(phone);
  const message = friendlyMessage(order.customer_name);
  const first = order.customer_name.trim().split(/\s+/)[0];

  useEffect(() => {
    setBusiness(loadBusiness());
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Build the PDF as soon as we know the business details.
  useEffect(() => {
    if (!business) return;
    let cancelled = false;
    setFile(null);
    setFailed(false);
    (async () => {
      try {
        const sale = await db.ledger_entries
          .where("ref_order_id")
          .equals(order.order_id)
          .filter((e) => e.entry_type === "SALE")
          .first();
        const { buildReceiptPdf } = await import("@/lib/receipt/pdf");
        const out = await buildReceiptPdf({
          order,
          business,
          customerPhone: phone ? formatPhoneDisplay(phone) : undefined,
          paidAt: sale?.created_at ?? order.created_at,
        });
        if (!cancelled) setFile(out.file);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business, order, phone]);

  const canShareFile =
    !!file &&
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  // Called directly from the tap, no awaits before navigator.share.
  function onSend() {
    if (!file) return;
    setNote(null);
    navigator
      .share({ files: [file], title: "Receipt", text: message })
      .catch((err) => {
        if (!isAbort(err)) setNote("We could not open the share menu. Try Download PDF instead.");
      });
  }

  function onOpenChat() {
    if (!file || !waPhone) return;
    download(file);
    openLink(whatsappUrl(message, waPhone));
    setNote("Saved the PDF. Tap the paperclip in WhatsApp to attach it.");
  }

  function onDownload() {
    if (!file) return;
    download(file);
    setNote("PDF saved to your downloads.");
  }

  return (
    <div className="fixed inset-0 z-[55] flex justify-center">
      <div className="sheet-backdrop relative flex h-full w-full max-w-md items-end">
        <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="sheet-panel relative max-h-[90%] w-full overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className="sheet-grab" />
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
                Send receipt
              </h2>
              <p className="truncate text-[16px] font-bold text-[#17104A]">{order.customer_name}</p>
              <p className="amount text-[14px] text-[#55517F]">
                {phone ? formatPhoneDisplay(phone) : "No phone number saved"}
              </p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="icon-btn shrink-0 bg-[#F1F0F8] text-[#3B3670]">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {business === undefined ? null : business === null ? (
            <div>
              <p className="mb-3 rounded-2xl bg-[#FEF6DC] px-3 py-2.5 text-[14px] font-semibold text-[#7A4300]">
                First, tell us your business name. It goes at the top of your receipts.
              </p>
              <BusinessForm initial={null} submitLabel="Save and continue" onSaved={setBusiness} />
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {failed ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800" role="alert">
                  We could not make the receipt. Please try again.
                </p>
              ) : !file ? (
                <p className="py-2 text-[15px] font-semibold text-[#55517F]" role="status">
                  Making your receipt…
                </p>
              ) : null}

              {canShareFile ? (
                <>
                  <button type="button" onClick={onSend} className="btn btn-success min-h-[54px]">
                    <Send className="size-5" aria-hidden />
                    Send PDF on WhatsApp
                  </button>
                  <p className="hint -mt-1">
                    WhatsApp will ask who to send to.{" "}
                    {first ? `Choose ${first}.` : "Choose your customer."}
                  </p>
                </>
              ) : null}

              {waPhone ? (
                <button type="button" disabled={!file} onClick={onOpenChat} className="btn btn-primary min-h-[54px]">
                  <MessageCircle className="size-5" aria-hidden />
                  Open chat instead
                </button>
              ) : null}

              <button type="button" disabled={!file} onClick={onDownload} className="btn btn-quiet">
                <Download className="size-5" aria-hidden />
                Download PDF
              </button>

              {note ? (
                <p className="text-[14px] font-semibold text-[#065F46]" role="status">
                  {note}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
