import type { Sku } from "@/types/bridgewise";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "pls",
  "please",
  "send",
  "want",
  "need",
  "abeg",
  "wan",
  "buy",
  "qty",
  "quantity",
  "pcs",
  "pieces",
  "size",
  "std",
]);

const COLOR_WORDS = new Set([
  "black",
  "blue",
  "red",
  "green",
  "yellow",
  "white",
  "brown",
  "pink",
  "gold",
  "silver",
  "grey",
  "gray",
  "orange",
  "purple",
  "navy",
  "beige",
]);

const TYPE_STEM: Record<string, string> = {
  bag: "bag",
  bags: "bag",
  handbag: "bag",
  handbags: "bag",
  purse: "bag",
  purses: "bag",
  shoe: "shoe",
  shoes: "shoe",
  cake: "cake",
  cakes: "cake",
};

export type ParsedMatchItem = {
  product_id: string;
  product_name: string;
  quantity: number;
};

/**
 * Honest SKU match: exact sku_id / display name, else token overlap
 * without a color clash (e.g. "black bags" does not become Blue_Handbag_Std).
 */
export function matchParsedItemToSku(
  item: ParsedMatchItem,
  skus: Sku[],
): Sku | null {
  const idHint = item.product_id.trim().toLowerCase();
  const nameNorm = normalize(item.product_name);

  for (const sku of skus) {
    if (idHint && idHint === sku.sku_id.toLowerCase()) return sku;
    if (nameNorm && nameNorm === sku.sku_id.toLowerCase()) return sku;
    if (nameNorm && nameNorm === normalize(sku.display_name)) return sku;
  }

  const itemTokens = tokens(`${item.product_name} ${item.product_id}`);
  if (itemTokens.length === 0) return null;

  let best: { sku: Sku; score: number } | null = null;
  for (const sku of skus) {
    const skuTokens = tokens(`${sku.display_name} ${sku.sku_id.replace(/_/g, " ")}`);
    if (colorConflict(itemTokens, skuTokens)) continue;
    const score = overlapScore(itemTokens, skuTokens);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { sku, score };
  }
  return best?.sku ?? null;
}

export function matchParsedItemsToSkus(
  items: ParsedMatchItem[],
  skus: Sku[],
): Array<{ product_id: string; quantity: number }> {
  const matched: Array<{ product_id: string; quantity: number }> = [];
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) continue;
    const sku = matchParsedItemToSku(item, skus);
    if (sku) {
      matched.push({ product_id: sku.sku_id, quantity: item.quantity });
    }
  }
  return matched;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .map(stem)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function stem(token: string): string {
  if (TYPE_STEM[token]) return TYPE_STEM[token];
  if (token.length > 3 && token.endsWith("s")) {
    const cut = token.slice(0, -1);
    return TYPE_STEM[cut] ?? cut;
  }
  return TYPE_STEM[token] ?? token;
}

function colorsIn(words: string[]): Set<string> {
  return new Set(words.filter((word) => COLOR_WORDS.has(word)));
}

function colorConflict(a: string[], b: string[]): boolean {
  const ca = colorsIn(a);
  const cb = colorsIn(b);
  if (ca.size === 0 || cb.size === 0) return false;
  for (const color of ca) {
    if (cb.has(color)) return false;
  }
  return true;
}

function overlapScore(itemTokens: string[], skuTokens: string[]): number {
  let score = 0;
  for (const token of itemTokens) {
    if (COLOR_WORDS.has(token)) continue;
    if (token.length < 3) continue;
    const hit = skuTokens.some(
      (skuToken) =>
        skuToken === token ||
        skuToken.includes(token) ||
        token.includes(skuToken),
    );
    if (hit) score += 1;
  }
  return score;
}
