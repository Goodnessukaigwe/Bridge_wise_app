import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { LIMITS, toContents, validateRequest } from "@/lib/agent/serverMap";
import { createThrottle } from "@/lib/agent/throttle";
import type { AgentErrorCode, AgentEvent } from "@/lib/agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Primary model, then fallbacks. gemini-2.5-flash answers 404 ("no longer
 * available to new users") on newer keys, so it is last, not first. Set
 * AGENT_MODEL to choose another.
 */
const MODELS = [
  process.env.AGENT_MODEL?.trim() || "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
].filter((m, i, all) => all.indexOf(m) === i);
let activeModel = 0;

// One turn can use up to 6 rounds, so allow a few turns a minute.
const allow = createThrottle(40, 5 * 60_000);

const TIMEOUT_MS = 45_000;

function fail(code: AgentErrorCode, status: number) {
  return Response.json({ error: code }, { status });
}

/**
 * POST { session, messages, tools } → NDJSON stream of AgentEvent.
 * The model runs here; tools run on the phone. Nothing is stored and message
 * content is never logged.
 */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fail("unavailable", 503);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.bodyBytes) return fail("too_large", 413);

  const device =
    request.headers.get("x-onrecord-device")?.slice(0, 64) ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (!allow(device)) return fail("throttled", 429);

  const text = await request.text().catch(() => "");
  if (!text || text.length > LIMITS.bodyBytes) return fail("too_large", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("bad_request", 400);
  }
  const v = validateRequest(body);
  if (!v.ok) return fail("bad_request", 400);
  const { session, messages, tools } = v.req;

  const ai = new GoogleGenAI({ apiKey });
  const config = {
    systemInstruction: buildSystemPrompt(session),
    tools: tools.length
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            })),
          },
        ]
      : undefined,
    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
    automaticFunctionCalling: { disable: true },
    thinkingConfig: { thinkingBudget: 0 },
    temperature: 0.3,
    maxOutputTokens: 1024,
  };
  const contents = toContents(messages);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  request.signal.addEventListener("abort", () => controller.abort());

  async function open() {
    let lastError: unknown;
    for (let i = activeModel; i < MODELS.length; i++) {
      try {
        const out = await ai.models.generateContentStream({
          model: MODELS[i],
          contents,
          config: { ...config, abortSignal: controller.signal },
        });
        return out;
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        const gone = msg.includes('"code":404') || msg.includes("no longer available");
        const busy = msg.includes('"code":503') || msg.includes("UNAVAILABLE");
        if (!gone && !busy) throw e;
        // A retired model is skipped from now on; a busy one only for this request.
        if (gone && i === activeModel) activeModel = Math.min(i + 1, MODELS.length - 1);
      }
    }
    throw lastError;
  }

  let stream: Awaited<ReturnType<typeof open>>;
  try {
    stream = await open();
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : "";
    // Log the kind of failure only, never content.
    console.error("agent_open_failed", msg.slice(0, 80));
    return fail(msg.includes("429") ? "busy" : "model_failed", 502);
  }

  const enc = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (e: AgentEvent) => ctrl.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        for await (const chunk of stream) {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thought) continue;
            if (part.functionCall?.name) {
              send({
                t: "call",
                name: part.functionCall.name,
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                ...(part.thoughtSignature ? { sig: part.thoughtSignature } : {}),
              });
            } else if (part.text) {
              send({ t: "text", v: part.text });
            }
          }
        }
        send({ t: "done" });
      } catch (e) {
        console.error("agent_stream_failed", e instanceof Error ? e.message.slice(0, 80) : "");
        send({ t: "error", code: "model_failed" });
      } finally {
        clearTimeout(timer);
        ctrl.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
