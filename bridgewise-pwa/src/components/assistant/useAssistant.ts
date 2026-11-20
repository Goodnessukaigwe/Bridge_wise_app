"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureChatText } from "@/lib/ai/captureText";
import { clearChat, loadChat, saveChatMessage } from "@/lib/agent/chatStore";
import { hasAiConsent } from "@/lib/agent/consent";
import { ToolExecutor } from "@/lib/agent/executor";
import { AgentError, deviceId, fetchTransport, runTurn } from "@/lib/agent/loop";
import { MAX_BODY_CHARS, type Picked } from "@/lib/agent/media";
import { buildSession } from "@/lib/agent/session";
import type { ChatCard, ChatMessage, WirePart } from "@/lib/agent/types";
import { historyToWire, scrubIds, splitReplies } from "@/lib/agent/wire";
import { loadBusiness } from "@/lib/business";

export type SendInput = {
  text: string;
  images?: Picked[];
  audio?: { mime: string; data: string };
};

const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function useAssistant() {
  const executor = useRef(new ToolExecutor());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<ChatMessage[]>([]);
  const busyRef = useRef(false);
  const lastInput = useRef<{ userId: string; input: SendInput } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const approving = useRef(new Set<string>());

  const commit = useCallback((next: ChatMessage[]) => {
    ref.current = next;
    setMessages(next);
  }, []);
  const patch = useCallback(
    (id: string, fn: (m: ChatMessage) => ChatMessage, persist = false) => {
      const next = ref.current.map((m) => (m.id === id ? fn(m) : m));
      commit(next);
      const hit = next.find((m) => m.id === id);
      if (persist && hit) void saveChatMessage(hit);
    },
    [commit],
  );

  useEffect(() => {
    let live = true;
    void loadChat()
      .then((rows) => {
        if (live) commit(rows);
      })
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [commit]);

  const runFor = useCallback(
    async (userId: string, input: SendInput) => {
      const asstId = uid();
      const idx = ref.current.findIndex((m) => m.id === userId);
      const userAt = ref.current[idx]?.at ?? Date.now();
      const before = ref.current.slice(0, idx);
      commit([
        ...ref.current,
        { id: asstId, role: "assistant", text: "", at: userAt + 1, progress: "Thinking..." },
      ]);
      busyRef.current = true;
      setBusy(true);
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const user: WirePart[] = [];
        if (input.text.trim()) user.push({ text: input.text.trim() });
        for (const img of input.images ?? []) user.push({ image: img.wire });
        if (input.audio) user.push({ audio: input.audio });
        if (user.length === 0) return;
        if (JSON.stringify(user).length > MAX_BODY_CHARS) throw new AgentError("too_large");

        const session = await buildSession(loadBusiness()?.name ?? "");
        const result = await runTurn({
          session,
          history: historyToWire(before),
          user,
          executor: executor.current,
          transport: fetchTransport(deviceId()),
          signal: ctl.signal,
          hooks: {
            onText: (d) =>
              patch(asstId, (m) => ({ ...m, text: m.text + d, progress: undefined })),
            onProgress: (line) => patch(asstId, (m) => ({ ...m, progress: line })),
            onCards: (cards) =>
              patch(asstId, (m) => ({ ...m, cards: [...(m.cards ?? []), ...cards] })),
          },
        });
        const split = splitReplies(scrubIds(result.text).trim());
        patch(
          asstId,
          (m) => ({
            ...m,
            text:
              split.text ||
              (result.capped
                ? "That needed more steps than I can do at once. Tell me what to do next."
                : m.cards?.length
                  ? ""
                  : "Done."),
            replies: split.replies.length ? split.replies : undefined,
            progress: undefined,
          }),
          true,
        );
      } catch (e) {
        if (ctl.signal.aborted) {
          patch(asstId, (m) => ({ ...m, progress: undefined, text: m.text || "Stopped." }), true);
        } else {
          const code = e instanceof AgentError ? e.code : "model_failed";
          patch(
            asstId,
            (m) => ({ ...m, progress: undefined, error: { code, retry: true } }),
            false,
          );
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
        abort.current = null;
      }
    },
    [commit, patch],
  );

  const send = useCallback(
    async (input: SendInput) => {
      if (busyRef.current || !hasAiConsent()) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        text: input.text.trim(),
        at: Date.now(),
        ...(input.images?.length ? { thumbs: input.images.map((i) => i.thumb) } : {}),
        ...(input.audio ? { voice: true } : {}),
      };
      commit([...ref.current, userMsg]);
      void saveChatMessage(userMsg);
      lastInput.current = { userId: userMsg.id, input };
      await runFor(userMsg.id, input);
    },
    [commit, runFor],
  );

  const retry = useCallback(async () => {
    const last = lastInput.current;
    if (busyRef.current || !last) return;
    // Drop the failed answer, keep the vendor's message, ask again.
    commit(ref.current.filter((m) => !m.error));
    await runFor(last.userId, last.input);
  }, [commit, runFor]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const setCard = useCallback(
    (msgId: string, cardId: string, fn: (c: ChatCard) => ChatCard) => {
      patch(
        msgId,
        (m) => ({ ...m, cards: m.cards?.map((c) => (c.id === cardId ? fn(c) : c)) }),
        true,
      );
    },
    [patch],
  );

  /** Only the Approve button calls this. The executor mints a one-time approval for this exact card. */
  const approve = useCallback(
    async (msgId: string, card: ChatCard) => {
      if (card.state !== "awaiting" || approving.current.has(card.id)) return;
      approving.current.add(card.id);
      try {
        const out = await executor.current.approve(card.id, card.proposal);
        const ok = out.response.ok === true;
        const note =
          typeof out.response.message === "string"
            ? out.response.message
            : ok
              ? "Done."
              : "That did not go through.";
        setCard(msgId, card.id, (c) => ({ ...c, state: ok ? "done" : "failed", note }));
      } finally {
        approving.current.delete(card.id);
      }
    },
    [setCard],
  );

  const cancelCard = useCallback(
    (msgId: string, card: ChatCard) => {
      executor.current.cancel(card.id);
      setCard(msgId, card.id, (c) => ({ ...c, state: "cancelled", note: "Cancelled. Nothing changed." }));
    },
    [setCard],
  );

  const undoCard = useCallback(
    async (msgId: string, card: ChatCard) => {
      const r = await executor.current.undo(card);
      setCard(msgId, card.id, (c) =>
        r.ok ? { ...c, state: "undone", undo: undefined, note: r.message } : { ...c, note: r.message },
      );
    },
    [setCard],
  );

  const clear = useCallback(async () => {
    abort.current?.abort();
    await clearChat();
    lastInput.current = null;
    commit([]);
  }, [commit]);

  /** Fallback that never needs the assistant: the old capture path, saving the raw text as a draft. */
  const saveDraft = useCallback(async (text: string) => {
    const out = await captureChatText({ raw_text: text, capture_method: "clipboard" });
    return out.ok
      ? { ok: true as const }
      : { ok: false as const, message: out.kind === "error" ? out.message : "Please check the details and try again." };
  }, []);

  return { messages, loaded, busy, send, retry, stop, approve, cancelCard, undoCard, clear, saveDraft };
}
