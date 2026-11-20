import { ToolExecutor, type ToolOutcome } from "@/lib/agent/executor";
import { TOOL_BY_NAME, wireTools } from "@/lib/agent/toolDefs";
import type {
  AgentErrorCode,
  AgentEvent,
  AgentRequest,
  ChatCard,
  SessionContext,
  WireMessage,
  WirePart,
} from "@/lib/agent/types";

export const MAX_ROUNDS = 6;

export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode | "offline") {
    super(code);
    this.name = "AgentError";
  }
}

/** Sends one request to the model and yields events. Injectable for tests. */
export type ModelTransport = (
  req: AgentRequest,
  signal?: AbortSignal,
) => AsyncIterable<AgentEvent>;

export type TurnHooks = {
  onText?: (delta: string) => void;
  onProgress?: (line: string) => void;
  onCards?: (cards: ChatCard[]) => void;
};

export type TurnInput = {
  session: SessionContext;
  /** History as wire messages, ending before the new user message. */
  history: WireMessage[];
  /** The new user message: text and any attachments. */
  user: WirePart[];
  executor: ToolExecutor;
  transport: ModelTransport;
  hooks?: TurnHooks;
  signal?: AbortSignal;
};

export type TurnResult = { text: string; cards: ChatCard[]; capped: boolean };

const HEARD = /\bI heard\b/i;

/**
 * One vendor message → the model, then (tool calls → run on the phone →
 * results back) up to 6 rounds, until the model answers in text.
 * The model can only ask; `executor.run` is the only thing it can reach,
 * and that never runs an approval tool.
 */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { session, history, user, executor, transport, hooks, signal } = input;
  const messages: WireMessage[] = [...history, { role: "user", parts: user }];
  const hasAudio = user.some((p) => "audio" in p);
  const cards: ChatCard[] = [];
  let fullText = "";
  const tools = wireTools();

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let roundText = "";
    const calls: Array<{ name: string; args: Record<string, unknown>; sig?: string }> = [];
    for await (const ev of transport({ session, messages, tools }, signal)) {
      if (ev.t === "text") {
        roundText += ev.v;
        fullText += ev.v;
        hooks?.onText?.(ev.v);
      } else if (ev.t === "call") {
        calls.push({ name: ev.name, args: ev.args, sig: ev.sig });
      } else if (ev.t === "error") {
        throw new AgentError(ev.code);
      }
    }
    if (calls.length === 0) return { text: fullText, cards, capped: false };

    const modelParts: WirePart[] = [];
    if (roundText.trim()) modelParts.push({ text: roundText });
    for (const c of calls) modelParts.push({ call: c });
    messages.push({ role: "model", parts: modelParts });

    // Read-only calls run together; anything that writes runs one at a time.
    const results: Array<{ name: string; response: Record<string, unknown> }> = new Array(calls.length);
    const runOne = async (i: number) => {
      const c = calls[i];
      const def = TOOL_BY_NAME.get(c.name);
      let outcome: ToolOutcome;
      if (def?.level === "approval" && hasAudio && !HEARD.test(fullText)) {
        outcome = {
          progress: "",
          response: { error: "first_say_what_you_heard", hint: 'Start with "I heard: …" then try again.' },
        };
      } else {
        hooks?.onProgress?.(def ? progressFor(c.name) : "Working on it...");
        outcome = await executor.run(c.name, c.args);
        if (outcome.progress) hooks?.onProgress?.(outcome.progress);
      }
      results[i] = { name: c.name, response: outcome.response };
      const made = [...(outcome.cards ?? []), ...(outcome.card ? [outcome.card] : [])];
      if (made.length) {
        cards.push(...made);
        hooks?.onCards?.(made);
      }
    };
    const readIdx = calls.map((c, i) => (TOOL_BY_NAME.get(c.name)?.level === "read" ? i : -1)).filter((i) => i >= 0);
    await Promise.all(readIdx.map(runOne));
    for (let i = 0; i < calls.length; i++) {
      if (!readIdx.includes(i)) await runOne(i);
    }
    messages.push({ role: "user", parts: results.map((r) => ({ result: r })) });
  }

  return { text: fullText, cards, capped: true };
}

function progressFor(tool: string): string {
  switch (tool) {
    case "get_stock":
    case "list_products":
      return "Checking stock...";
    case "search_customers":
    case "get_customer_history":
      return "Looking for the customer...";
    case "list_orders":
    case "get_order":
      return "Checking your orders...";
    case "get_pocket_statement":
      return "Counting your money...";
    case "get_product_performance":
      return "Checking what is selling...";
    case "create_pending_order":
      return "Saving the enquiry...";
    default:
      return "Working on it...";
  }
}

/** Real transport: POST /api/agent and read NDJSON. */
export function fetchTransport(deviceId: string): ModelTransport {
  return async function* (req, signal) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new AgentError("offline");
    }
    let res: Response;
    try {
      res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-onrecord-device": deviceId },
        body: JSON.stringify(req),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new AgentError("model_failed");
    }
    if (!res.ok || !res.body) {
      const code = (await res.json().catch(() => null))?.error as AgentErrorCode | undefined;
      throw new AgentError(code ?? "model_failed");
    }
    yield* parseNdjson(res.body);
  };
}

export async function* parseNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new AgentError("model_failed");
      }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as AgentEvent;
        } catch {
          /* skip a broken line */
        }
      }
    }
    if (buf.trim()) {
      try {
        yield JSON.parse(buf) as AgentEvent;
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function deviceId(): string {
  try {
    const k = "onrecord_device";
    let id = window.localStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return "anon";
  }
}
