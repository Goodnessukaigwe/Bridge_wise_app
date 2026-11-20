"use client";

import { Check, ChevronRight, Undo2 } from "lucide-react";
import type { ChatCard, CardOpen } from "@/lib/agent/types";

const KIND_STYLE: Record<ChatCard["kind"], string> = {
  order: "border-[#DAD7EE] bg-white",
  customer: "border-[#DAD7EE] bg-white",
  stock: "border-[#DAD7EE] bg-white",
  statement: "border-[#DAD7EE] bg-white",
  products: "border-[#DAD7EE] bg-white",
  orders: "border-[#DAD7EE] bg-white",
  action: "border-[#F5C77A] bg-[#FFF8EA]",
};

export function CardView({
  card,
  busy,
  onOpen,
  onApprove,
  onCancel,
  onUndo,
}: {
  card: ChatCard;
  busy: boolean;
  onOpen: (open: CardOpen) => void;
  onApprove: (card: ChatCard) => void;
  onCancel: (card: ChatCard) => void;
  onUndo: (card: ChatCard) => void;
}) {
  const awaiting = card.state === "awaiting";
  const tint =
    card.state === "done"
      ? "border-[#9FDCC0] bg-[#EFFBF5]"
      : card.state === "failed"
        ? "border-[#F5B5B5] bg-[#FEF1F1]"
        : card.state === "cancelled" || card.state === "undone"
          ? "border-[#DAD7EE] bg-[#F6F5FB] opacity-80"
          : KIND_STYLE[card.kind];

  const body = (
    <>
      <p className="text-[15px] font-bold leading-snug text-[#0F0A2E]">{card.title}</p>
      {card.lines.map((l, i) => (
        <p key={i} className="mt-0.5 text-[14px] leading-snug text-[#55517F]">
          {l}
        </p>
      ))}
    </>
  );

  return (
    <div className={`anim-card w-full rounded-2xl border p-3 ${tint}`}>
      {card.open && !awaiting ? (
        <button
          type="button"
          onClick={() => onOpen(card.open!)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1">{body}</span>
          <ChevronRight className="size-5 shrink-0 text-[#8F8BB3]" aria-hidden />
        </button>
      ) : (
        <div>{body}</div>
      )}

      {card.note ? (
        <p
          className={`mt-1.5 flex items-center gap-1 text-[13px] font-semibold ${
            card.state === "failed" ? "text-red-700" : card.state === "done" ? "text-[#0B7A55]" : "text-[#9A5B0B]"
          }`}
        >
          {card.state === "done" ? <Check className="size-4" aria-hidden /> : null}
          {card.note}
        </p>
      ) : null}

      {awaiting ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              // Only a real finger tap on this card counts as approval.
              if (!e.nativeEvent.isTrusted) return;
              onApprove(card);
            }}
            className="btn btn-success min-h-11 flex-1"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onCancel(card)}
            className="btn btn-quiet min-h-11 flex-1"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {card.undo && !card.state ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onUndo(card)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-[14px] font-bold text-[#3B3670]"
          >
            <Undo2 className="size-4" aria-hidden /> Undo
          </button>
          {card.open ? (
            <button
              type="button"
              onClick={() => onOpen(card.open!)}
              className="inline-flex min-h-10 items-center rounded-xl px-3 text-[14px] font-bold text-[#3B3670]"
            >
              Edit
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
