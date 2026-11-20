import type { Sku } from "@/types/bridgewise";

/** Spelling-tolerant product search for the assistant. Pure, no database. */

function norm(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NOISE = new Set(["the", "and", "for", "pls", "please", "abeg", "pcs", "pieces", "of", "a", "one"]);

function stem(t: string): string {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

function toks(v: string): string[] {
  return norm(v)
    .split(" ")
    .map(stem)
    .filter((t) => t && !NOISE.has(t));
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function tokenSimilarity(q: string, s: string): number {
  if (q === s) return 1;
  if (q.length >= 3 && (s.includes(q) || q.includes(s)) && Math.min(q.length, s.length) >= 3) {
    return 0.9;
  }
  const allowed = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  const d = editDistance(q, s);
  if (d <= allowed) return 1 - d / Math.max(q.length, s.length);
  return 0;
}

export type SkuMatch = { sku: Sku; score: number };

export type FuzzyResult = {
  /** Best first. Empty when nothing is close enough. */
  matches: SkuMatch[];
  /** True when two or more different products are about equally good. */
  ambiguous: boolean;
};

const THRESHOLD = 0.6;

export function fuzzyFindSkus(query: string, skus: Sku[]): FuzzyResult {
  const q = norm(query);
  if (!q) return { matches: [], ambiguous: false };

  const exact = skus.filter(
    (s) => norm(s.display_name) === q || s.sku_id.toLowerCase() === query.trim().toLowerCase(),
  );
  if (exact.length === 1) {
    return { matches: [{ sku: exact[0], score: 1 }], ambiguous: false };
  }

  const qt = toks(query);
  if (qt.length === 0) return { matches: [], ambiguous: false };

  const scored: SkuMatch[] = [];
  for (const sku of skus) {
    const st = toks(`${sku.display_name} ${sku.sku_id.replace(/_/g, " ")}`);
    let total = 0;
    let conflict = false;
    for (const t of qt) {
      let best = 0;
      for (const s of st) best = Math.max(best, tokenSimilarity(t, s));
      total += best;
      if (best === 0 && COLOURS.has(t) && st.some((s) => COLOURS.has(s))) {
        conflict = true;
      }
    }
    if (conflict) continue;
    const score = total / qt.length;
    if (score >= THRESHOLD) scored.push({ sku, score });
  }
  scored.sort((a, b) => b.score - a.score || a.sku.display_name.localeCompare(b.sku.display_name));
  const top = scored.slice(0, 4);
  const ambiguous =
    top.length > 1 && top[0].score < 1 ? top[1].score >= top[0].score - 0.1 : top.length > 1 && top[1].score === top[0].score;
  return { matches: top, ambiguous };
}

const COLOURS = new Set([
  "black", "blue", "red", "green", "yellow", "white", "brown", "pink", "gold",
  "silver", "grey", "gray", "orange", "purple", "navy", "beige",
]);
