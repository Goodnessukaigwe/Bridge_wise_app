/**
 * Three-tier customer identity from WhatsApp text.
 * Capture always gets a name — walk-in is the fallback, never a blocker.
 */

export type IdentityTier = 1 | 2 | 3;

export type ResolvedIdentity = {
  name: string;
  address: string;
  tier: IdentityTier;
};

/** `[11/12, 10:15 AM] Amaka: …` or `[10:14 AM] Chioma Nwosu: …` */
const WHATSAPP_BRACKET = /^\[.+?\]\s*([^:\n]+):/;
/** `11/12/26, 10:15 AM - Amaka: …` */
const WHATSAPP_EXPORT =
  /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,\s*.+?\s+-\s+([^:\n]+):/;

const HEADER_SKIP = new Set(["you", "whatsapp", "system"]);

const NAME_TOKEN = String.raw`(?!from\b)[A-Za-z][A-Za-z'.-]*`;
const SELF_ID = new RegExp(
  String.raw`\b(?:this\s+is|i\s*am|i['’]m|my\s+name\s+is|na\s+me|i\s+be)\s+(${NAME_TOKEN}(?:\s+${NAME_TOKEN}){0,2})(?:\s+from\s+([^\n]+))?`,
  "i",
);

const NAME_STOP = new Set([
  "a",
  "an",
  "available",
  "for",
  "it",
  "just",
  "my",
  "not",
  "that",
  "the",
  "this",
  "to",
]);

const PLACE_STOP = new Set([
  "abeg",
  "buy",
  "how",
  "i",
  "i'm",
  "need",
  "please",
  "pls",
  "send",
  "transfer",
  "una",
  "wan",
  "want",
]);

export function isWalkInName(name: string): boolean {
  return /^Walk-in \/ Inquiry #\d+$/.test(name.trim());
}

export function walkInName(seq: number): string {
  return `Walk-in / Inquiry #${String(seq).padStart(3, "0")}`;
}

export function resolveCustomerIdentity(
  raw: string,
  seq: number,
): ResolvedIdentity {
  const header = nameFromWhatsAppHeader(raw);
  if (header) return { name: header, address: "", tier: 1 };

  const selfId = nameFromSelfId(raw);
  if (selfId) {
    return { name: selfId.name, address: selfId.address, tier: 2 };
  }

  return { name: walkInName(seq), address: "", tier: 3 };
}

/** Header / self-ID beat a weaker model name. Walk-in yields to a real model name. */
export function preferResolvedName(
  resolved: ResolvedIdentity,
  modelName?: string,
): string {
  if (resolved.tier === 1 || resolved.tier === 2) return resolved.name;
  const model = modelName?.trim() ?? "";
  if (model && !isWalkInName(model)) return model;
  return resolved.name;
}

/** Model address wins when present; Tier 2 “from Ikeja” fills the gap. */
export function preferResolvedAddress(
  resolved: ResolvedIdentity,
  modelAddress?: string,
): string {
  const model = modelAddress?.trim() ?? "";
  if (model) return model;
  return resolved.address;
}

export function nameFromWhatsAppHeader(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bracket = trimmed.match(WHATSAPP_BRACKET);
    const exported = trimmed.match(WHATSAPP_EXPORT);
    const candidate = cleanPersonName(bracket?.[1] ?? exported?.[1] ?? "");
    if (candidate) return candidate;
  }
  return null;
}

export function nameFromSelfId(
  raw: string,
): { name: string; address: string } | null {
  const match = raw.match(SELF_ID);
  if (!match?.[1]) return null;
  const name = cleanPersonName(match[1]);
  if (!name) return null;
  return { name, address: takePlace(match[2] ?? "") };
}

function cleanPersonName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return null;
  const first = name.split(" ")[0]?.toLowerCase() ?? "";
  if (HEADER_SKIP.has(first) || NAME_STOP.has(first)) return null;
  if (!/[A-Za-z]/.test(name)) return null;
  return name;
}

function takePlace(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const place: string[] = [];
  for (const word of words) {
    const cleaned = word.replace(/[.,!?]+$/g, "");
    if (!cleaned || PLACE_STOP.has(cleaned.toLowerCase())) break;
    place.push(cleaned);
    if (place.length >= 4) break;
    if (/[.,!?]$/.test(word)) break;
  }
  return place.join(" ");
}
