import type { Content, Part } from "@google/genai";
import type { AgentRequest, WireMessage } from "@/lib/agent/types";

/** Hard limits, checked on the server whatever the client says. */
export const LIMITS = {
  bodyBytes: 4_000_000,
  messages: 48,
  partsPerMessage: 12,
  tools: 25,
  textChars: 20_000,
  schemaChars: 3_000,
};

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_MIME = new Set(["audio/wav", "audio/mp3", "audio/aac", "audio/ogg", "audio/flac", "audio/aiff"]);
const NAME = /^[a-z_]{1,40}$/;

export type Validated = { ok: true; req: AgentRequest } | { ok: false };

/** Shape check on an untrusted body. Does not trust sizes or types. */
export function validateRequest(raw: unknown): Validated {
  const bad: Validated = { ok: false };
  if (!raw || typeof raw !== "object") return bad;
  const r = raw as Partial<AgentRequest>;
  if (!r.session || typeof r.session !== "object") return bad;
  if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > LIMITS.messages) return bad;
  if (!Array.isArray(r.tools) || r.tools.length > LIMITS.tools) return bad;

  for (const t of r.tools) {
    if (!t || !NAME.test(String(t.name)) || typeof t.description !== "string") return bad;
    if (t.description.length > 600) return bad;
    if (JSON.stringify(t.parameters ?? {}).length > LIMITS.schemaChars) return bad;
  }
  for (const m of r.messages) {
    if (!m || (m.role !== "user" && m.role !== "model") || !Array.isArray(m.parts)) return bad;
    if (m.parts.length === 0 || m.parts.length > LIMITS.partsPerMessage) return bad;
    for (const p of m.parts) {
      if (!p || typeof p !== "object") return bad;
      if ("text" in p) {
        if (typeof p.text !== "string" || p.text.length > LIMITS.textChars) return bad;
      } else if ("image" in p) {
        if (!IMAGE_MIME.has(p.image?.mime) || typeof p.image.data !== "string") return bad;
        if (m.role !== "user") return bad;
      } else if ("audio" in p) {
        if (!AUDIO_MIME.has(p.audio?.mime) || typeof p.audio.data !== "string") return bad;
        if (m.role !== "user") return bad;
      } else if ("call" in p) {
        if (m.role !== "model" || !NAME.test(String(p.call?.name))) return bad;
      } else if ("result" in p) {
        if (m.role !== "user" || !NAME.test(String(p.result?.name))) return bad;
      } else return bad;
    }
  }
  return { ok: true, req: r as AgentRequest };
}

export function toContents(messages: WireMessage[]): Content[] {
  return messages.map((m) => ({
    role: m.role,
    parts: m.parts.map((p): Part => {
      if ("text" in p) return { text: p.text };
      if ("image" in p) return { inlineData: { mimeType: p.image.mime, data: p.image.data } };
      if ("audio" in p) return { inlineData: { mimeType: p.audio.mime, data: p.audio.data } };
      if ("call" in p) {
        return {
          functionCall: { name: p.call.name, args: p.call.args ?? {} },
          ...(p.call.sig ? { thoughtSignature: p.call.sig } : {}),
        };
      }
      return { functionResponse: { name: p.result.name, response: p.result.response ?? {} } };
    }),
  }));
}
