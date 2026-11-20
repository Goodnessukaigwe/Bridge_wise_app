import type { ChatCard, ChatMessage, QuickReply, WireMessage } from "@/lib/agent/types";

export const HISTORY_LIMIT = 20;

/** Internal keys look like Chioma_2026-11-12_Ord004, TXN_…, CUST_…, Black_Shoes_Size42. */
const ID_PATTERNS: RegExp[] = [
  /\b[\w'’.-]+_\d{4}-\d{2}-\d{2}_Ord\d{3}\b/g,
  /\bTXN_\d{4}-\d{2}-\d{2}_[A-Z]+_\d{3}\b/g,
  /\bCUST_[\w+-]+\b/g,
  /\bDaily_Summary_\d{4}-\d{2}-\d{2}\b/g,
  /\b[A-Z][A-Za-z0-9]*(?:_[A-Za-z0-9+-]+)+\b/g,
];

/** Belt and braces: whatever the model writes, internal keys never reach the screen. */
export function scrubIds(text: string): string {
  let out = text;
  for (const re of ID_PATTERNS) out = out.replace(re, "");
  return out.replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,!?])/g, "$1");
}

const REPLIES = /\[\[([^\]]{1,200})\]\]\s*$/;

/** Splits a trailing `[[A|B|C]]` into quick-reply buttons. */
export function splitReplies(text: string): { text: string; replies: QuickReply[] } {
  const m = text.match(REPLIES);
  if (!m) return { text, replies: [] };
  const replies = m[1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((label) => ({ label, send: label }));
  return { text: text.slice(0, m.index).trimEnd(), replies };
}

function cardNote(c: ChatCard): string {
  const ref = c.open && "order_ref" in c.open ? ` order_ref=${c.open.order_ref}` : "";
  const cref = c.open && "customer_ref" in c.open ? ` customer_ref=${c.open.customer_ref}` : "";
  return `[card:${c.kind} "${c.title}"${ref}${cref}${c.state ? ` state=${c.state}` : ""}]`;
}

/**
 * Last N messages as plain text for the model. Photos and voice notes become
 * a short marker (the model's own "I heard…" reply stays). Cards become a
 * one-line note so "confirm it" can find the right order.
 */
export function historyToWire(history: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of history.slice(-HISTORY_LIMIT)) {
    if (m.error) continue;
    const bits: string[] = [];
    if (m.text.trim()) bits.push(m.text.trim());
    if (m.thumbs?.length) bits.push(`[${m.thumbs.length} photo${m.thumbs.length === 1 ? "" : "s"} sent earlier]`);
    if (m.voice) bits.push("[voice note sent earlier]");
    for (const c of m.cards ?? []) bits.push(cardNote(c));
    if (bits.length === 0) continue;
    const role = m.role === "user" ? "user" : "model";
    const text = bits.join("\n");
    const last = out[out.length - 1];
    if (last && last.role === role) {
      (last.parts[0] as { text: string }).text += `\n${text}`;
    } else {
      out.push({ role, parts: [{ text }] });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
