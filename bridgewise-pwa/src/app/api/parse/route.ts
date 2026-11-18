import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { coerceParseResult } from "@/lib/ai/coerceParse";
import {
  PARSE_MODEL,
  PARSE_MODEL_FALLBACK,
  PARSE_RESPONSE_SCHEMA,
  PARSE_SYSTEM_INSTRUCTION,
} from "@/lib/ai/prompts";
import type { CaptureMethod } from "@/types/bridgewise";

export const runtime = "nodejs";

/** Stick to 3.8 after 2.5-flash 404s for this process (new AI Studio keys). */
let activeParseModel = PARSE_MODEL;

const CAPTURE_METHODS = new Set<CaptureMethod>([
  "whatsapp_share_sheet",
  "clipboard",
  "manual",
]);

type ParseBody = {
  text?: unknown;
  capture_method?: unknown;
};

/**
 * POST { text, capture_method } → ParseResult.
 * IndexedDB / Dexie is browser-only — this route never writes orders,
 * inventory, or ledger. Commit flags from the model are discarded.
 */
export async function POST(request: Request) {
  let body: ParseBody;
  try {
    body = (await request.json()) as ParseBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text_required" }, { status: 400 });
  }

  const capture_method = body.capture_method;
  if (
    typeof capture_method !== "string" ||
    !CAPTURE_METHODS.has(capture_method as CaptureMethod)
  ) {
    return NextResponse.json(
      { error: "capture_method_invalid" },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "parse_unavailable" }, { status: 503 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Capture method: ${capture_method}\n\nChat:\n${text}`;
    const response = await generateParseJson(ai, activeParseModel, prompt).catch(
      (error: unknown) => {
        if (
          activeParseModel === PARSE_MODEL_FALLBACK ||
          !isModelUnavailable(error)
        ) {
          throw error;
        }
        activeParseModel = PARSE_MODEL_FALLBACK;
        return generateParseJson(ai, activeParseModel, prompt);
      },
    );

    const rawText = response.text?.trim();
    if (!rawText) {
      return NextResponse.json({ error: "empty_model_response" }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      return NextResponse.json({ error: "invalid_model_json" }, { status: 502 });
    }

    return NextResponse.json(
      coerceParseResult(parsed, capture_method as CaptureMethod),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("parse_failed", message);
    return NextResponse.json({ error: "parse_failed" }, { status: 502 });
  }
}

const PARSE_TIMEOUT_MS = 25_000;

async function generateParseJson(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
) {
  const run = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
    return ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: PARSE_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: PARSE_RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: controller.signal,
      },
    }).finally(() => clearTimeout(timer));
  };

  try {
    return await run();
  } catch (error) {
    if (!isTransientUnavailable(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return run();
  }
}

function isModelUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('"code":404') || message.includes("no longer available");
}

function isTransientUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('"code":503') || message.includes("UNAVAILABLE");
}
