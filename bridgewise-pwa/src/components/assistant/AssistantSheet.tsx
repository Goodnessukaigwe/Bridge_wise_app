"use client";

import { Loader2, MoreVertical, Mic, ShieldCheck, Trash2, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardView } from "@/components/assistant/CardView";
import { Composer } from "@/components/assistant/Composer";
import { useAssistant } from "@/components/assistant/useAssistant";
import { giveAiConsent, hasAiConsent } from "@/lib/agent/consent";
import type { CardOpen, ChatMessage } from "@/lib/agent/types";
import { scrubIds } from "@/lib/agent/wire";

export type Incoming = { text?: string; files?: File[]; token: number };

const ERRORS: Record<string, string> = {
  offline: "You are offline. You can still save the message as a draft.",
  throttled: "Too many messages too fast. Wait a minute and try again.",
  too_large: "That is too big to send. Try fewer or smaller photos.",
  busy: "The assistant is busy right now. Please try again.",
  unavailable: "The assistant is not switched on yet. You can still save the message as a draft.",
};

export function AssistantSheet({
  onClose,
  onOpen,
  onQuickCapture,
  incoming,
}: {
  onClose: () => void;
  onOpen: (open: CardOpen) => void;
  onQuickCapture: () => void;
  incoming?: Incoming | null;
}) {
  const a = useAssistant();
  const [consent, setConsent] = useState<boolean | null>(null);
  const [online, setOnline] = useState(true);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => setConsent(hasAiConsent()), []);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [a.messages, a.busy]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const lastAssistant = [...a.messages].reverse().find((m) => m.role === "assistant");

  return (
    <div
      className="assistant-sheet absolute inset-0 z-50 flex flex-col bg-[#F6F5FB]"
      role="dialog"
      aria-modal="true"
      aria-label="OnRecord assistant"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 bg-gradient-to-b from-[#241A6E] to-[#17104A] px-3">
        <button type="button" onClick={onClose} className="icon-btn text-white" aria-label="Close assistant">
          <X className="size-6" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-extrabold leading-tight text-white">OnRecord assistant</p>
          <p className="text-[12px] font-semibold leading-tight text-[#B8B3E6]">Nothing is sold until you tap Approve</p>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} className="icon-btn text-white" aria-label="More">
            <MoreVertical className="size-5" aria-hidden />
          </button>
          {menu ? (
            <div className="absolute right-0 top-12 z-10 w-56 rounded-2xl border border-[#DAD7EE] bg-white p-1 shadow-lg">
              <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-[15px] font-semibold text-[#17104A] active:bg-[#F1F0F8]"
                onClick={() => { setMenu(false); onQuickCapture(); }}>
                Save a chat as a draft
              </button>
              <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-[15px] font-semibold text-red-700 active:bg-red-50"
                onClick={() => { setMenu(false); if (window.confirm("Clear this chat? Your orders, stock and money are not touched.")) void a.clear(); }}>
                <Trash2 className="size-4" aria-hidden /> Clear chat
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {!online ? (
        <p role="status" className="flex items-center gap-2 bg-[#FFE9CC] px-4 py-2 text-[14px] font-semibold text-[#8A4B08]">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          No network. Every other screen still works, and you can save a chat as a draft.
        </p>
      ) : null}

      {consent === false ? (
        <Consent
          onAgree={() => {
            giveAiConsent();
            setConsent(true);
          }}
          onNotNow={onClose}
          onDraft={onQuickCapture}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {a.loaded && a.messages.length === 0 ? <Welcome /> : null}
            <div className="flex flex-col gap-3">
              {a.messages.map((m) => (
                <Bubble
                  key={m.id}
                  m={m}
                  isLast={m.id === lastAssistant?.id}
                  busy={a.busy}
                  online={online}
                  onOpen={onOpen}
                  onReply={(t) => void a.send({ text: t })}
                  onRetry={() => void a.retry()}
                  onDraft={() => {
                    const lastUser = [...a.messages].reverse().find((x) => x.role === "user");
                    if (!lastUser?.text) return;
                    void a.saveDraft(lastUser.text).then((r) =>
                      setNotice(r.ok ? "Saved as a draft. Open Orders to see it." : r.message ?? "Could not save."),
                    );
                  }}
                  onApprove={(c) => void a.approve(m.id, c)}
                  onCancel={(c) => a.cancelCard(m.id, c)}
                  onUndo={(c) => void a.undoCard(m.id, c)}
                />
              ))}
            </div>
            <div ref={end} />
          </div>
          {notice ? (
            <p role="status" className="mx-3 mb-2 rounded-xl bg-[#17104A] px-3 py-2 text-[14px] font-semibold text-white">
              {notice}
            </p>
          ) : null}
          <Composer
            busy={a.busy}
            online={online}
            incoming={incoming}
            onSend={(i) => void a.send(i)}
            onStop={a.stop}
            onSaveDraft={a.saveDraft}
            onNotice={setNotice}
          />
        </>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="mx-2 mt-6 rounded-2xl bg-white p-4 text-[15px] leading-relaxed text-[#55517F]">
      <p className="font-bold text-[#0F0A2E]">Hello! Tell me what happened today.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Paste a WhatsApp chat and I will save it as a not-paid order.</li>
        <li>Say or type “Restocked 20 Ankara for 40k” or “Fuel 5k”.</li>
        <li>Send a photo of a list, a receipt or a transfer screenshot.</li>
        <li>Ask “how many Black Shoes are left?” or “wetin I sell today?”.</li>
      </ul>
    </div>
  );
}

function Consent({ onAgree, onNotNow, onDraft }: { onAgree: () => void; onNotNow: () => void; onDraft: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto max-w-sm rounded-3xl bg-white p-5">
        <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#E6E3FA] text-[#17104A]">
          <ShieldCheck className="size-7" aria-hidden />
        </span>
        <h2 className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">Before we start</h2>
        <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-[#55517F]">
          <p>
            The assistant uses an AI service from Google to understand what you type, paste, photograph or say. When
            you send a message, the words, photos and voice notes in it are sent over the internet to that service.
            Nothing is sent until you agree.
          </p>
          <p>
            Your orders, stock, customers and money stay on this phone. Only what is needed to answer you is sent.
            Photos and voice notes are not kept in the chat.
          </p>
          <p>
            Pasted chats may include your customers’ names and numbers. Please do not send bank PINs, passwords or
            anything private. Google may keep messages for a short time to check for misuse.
          </p>
          <p className="flex items-start gap-2">
            <Mic className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>The assistant can only suggest. It never sells, deletes or records money until you tap Approve.</span>
          </p>
        </div>
        <button type="button" onClick={onAgree} className="btn btn-primary mt-5 w-full">
          I agree
        </button>
        <button type="button" onClick={onNotNow} className="btn btn-quiet mt-2 w-full">
          Not now
        </button>
        <button type="button" onClick={onDraft} className="mt-3 w-full min-h-11 text-[14px] font-bold text-[#3B3670] underline underline-offset-2">
          Just save a chat as a draft
        </button>
      </div>
    </div>
  );
}

function Bubble({
  m, isLast, busy, online, onOpen, onReply, onRetry, onDraft, onApprove, onCancel, onUndo,
}: {
  m: ChatMessage;
  isLast: boolean;
  busy: boolean;
  online: boolean;
  onOpen: (o: CardOpen) => void;
  onReply: (t: string) => void;
  onRetry: () => void;
  onDraft: () => void;
  onApprove: (c: import("@/lib/agent/types").ChatCard) => void;
  onCancel: (c: import("@/lib/agent/types").ChatCard) => void;
  onUndo: (c: import("@/lib/agent/types").ChatCard) => void;
}) {
  const mine = m.role === "user";
  const text = scrubIds(m.text);
  return (
    <div className={`flex flex-col gap-2 ${mine ? "items-end" : "items-start"}`}>
      {(text || m.thumbs?.length || m.voice) && (
        <div
          className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${
            mine ? "rounded-br-md bg-[#17104A] text-white" : "rounded-bl-md bg-white text-[#0F0A2E]"
          }`}
        >
          {m.thumbs?.length ? (
            <div className="mb-1.5 flex gap-1.5">
              {m.thumbs.map((t, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={t} alt="Photo you sent" className="size-16 rounded-lg object-cover" />
              ))}
            </div>
          ) : null}
          {m.voice ? (
            <p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold opacity-80">
              <Mic className="size-4" aria-hidden /> Voice note
            </p>
          ) : null}
          {text ? <p className="whitespace-pre-wrap break-words">{text}</p> : null}
        </div>
      )}
      {m.progress ? (
        <p role="status" className="flex items-center gap-2 px-1 text-[14px] font-semibold text-[#6B67A0]">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {m.progress}
        </p>
      ) : null}
      {m.cards?.length ? (
        <div className="flex w-full max-w-[96%] flex-col gap-2">
          {m.cards.map((c) => (
            <CardView key={c.id} card={c} busy={busy} onOpen={onOpen} onApprove={onApprove} onCancel={onCancel} onUndo={onUndo} />
          ))}
        </div>
      ) : null}
      {m.error ? (
        <div className="max-w-[92%] rounded-2xl bg-red-50 px-3.5 py-2.5 text-[14px] font-semibold text-red-800" role="alert">
          <p>{ERRORS[m.error.code] ?? "Something went wrong on our side. Your records are safe."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {m.error.code !== "unavailable" ? (
              <button type="button" onClick={onRetry} disabled={busy || !online} className="btn btn-secondary min-h-10 px-4 text-[14px]">
                Try again
              </button>
            ) : null}
            <button type="button" onClick={onDraft} className="btn btn-quiet min-h-10 px-4 text-[14px]">
              Save as a draft
            </button>
          </div>
        </div>
      ) : null}
      {isLast && !busy && m.replies?.length ? (
        <div className="flex flex-wrap gap-2">
          {m.replies.map((r) => (
            <button key={r.label} type="button" onClick={() => onReply(r.send)}
              className="min-h-10 rounded-full border-[1.5px] border-[#17104A] bg-white px-4 text-[14px] font-bold text-[#17104A] active:bg-[#E6E3FA]">
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
