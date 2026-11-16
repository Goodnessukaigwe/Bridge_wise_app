import { db } from "@/lib/db/dexie";
import {
  commitExpense,
  commitRestock,
  createPendingDraft,
  createPendingOrder,
} from "@/lib/db/transactions";
import { matchParsedItemToSku, matchParsedItemsToSkus } from "@/lib/ai/skuMatch";
import { enqueueParse } from "@/lib/sync/syncQueue";
import type {
  CaptureMethod,
  Order,
  ParseKind,
  ParseResult,
} from "@/types/bridgewise";

export type CaptureTextInput = {
  raw_text: string;
  capture_method: Extract<CaptureMethod, "clipboard" | "whatsapp_share_sheet">;
};

export type CaptureRestockPending = {
  qty: number;
  total_cost: number;
  product_name: string;
  sku_id?: string;
};

export type CaptureOutcome =
  | { ok: true; kind: "order"; order: Order }
  | { ok: true; kind: "expense"; txn_ids: string[] }
  | { ok: true; kind: "restock"; sku_id: string; qty: number; txn_id: string }
  | { ok: false; kind: "needs_restock_sheet"; pending: CaptureRestockPending }
  | { ok: false; kind: "error"; message: string };

const EXPENSE_WORD =
  /\b(fuel|nylon|transport|fare|data|airtime|generator|packaging|expense|spent)\b/i;
const RESTOCK_WORD =
  /\b(restocked|restock|supplier)\b/i;
const NOISE_CATEGORY =
  /^(i|the|a|an|for|and|pls|please|send|paid|pay|of|to|on|my)$/i;

/**
 * Online: POST /api/parse, then branch on kind.
 * Expense → commitExpense. Restock → commitRestock or a SKU picker sheet.
 * Unmatched expense/restock never become a pending SALE.
 * Order path: SKU-match then createPendingOrder; else createPendingDraft.
 */
export async function captureChatText(
  input: CaptureTextInput,
): Promise<CaptureOutcome> {
  const raw_text = input.raw_text.trim();
  if (!raw_text) {
    return { ok: false, kind: "error", message: "Paste or type something first." };
  }

  const localKind = heuristicKind(raw_text);
  if (localKind === "expense" && extractExpenseLines(raw_text).length > 0) {
    return commitExpensesFromCapture(null, raw_text);
  }
  if (localKind === "restock" && extractRestockHint(raw_text)) {
    return commitRestockFromCapture(null, raw_text);
  }

  const parsed = await tryParse(raw_text, input.capture_method);
  const kind = resolveKind(parsed, raw_text);

  if (kind === "expense") {
    return commitExpensesFromCapture(parsed, raw_text);
  }
  if (kind === "restock") {
    return commitRestockFromCapture(parsed, raw_text);
  }

  return savePendingOrder(parsed, raw_text, input.capture_method);
}

async function tryParse(
  raw_text: string,
  capture_method: CaptureTextInput["capture_method"],
): Promise<ParseResult | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return null;
  }
  try {
    const response = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: raw_text,
        capture_method,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as ParseResult;
    if (parsed.ledger_committed || parsed.status !== "PENDING_INQUIRY") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveKind(parsed: ParseResult | null, raw_text: string): ParseKind {
  const local = heuristicKind(raw_text);
  if (local === "expense" || local === "restock") {
    const looksLikeChat =
      /\[\d{1,2}\/\d{1,2}/.test(raw_text) ||
      /\b(how much|una get|transfer sent|pls send|please send)\b/i.test(
        raw_text,
      );
    if (!looksLikeChat) return local;
  }
  if (parsed?.kind === "expense" || parsed?.kind === "restock") {
    return parsed.kind;
  }
  return "order";
}

function heuristicKind(text: string): ParseKind {
  if (RESTOCK_WORD.test(text)) return "restock";
  if (EXPENSE_WORD.test(text)) return "expense";
  return "order";
}

async function commitExpensesFromCapture(
  parsed: ParseResult | null,
  raw_text: string,
): Promise<CaptureOutcome> {
  const lines = expenseLinesFrom(parsed, raw_text);
  if (lines.length === 0) {
    return {
      ok: false,
      kind: "error",
      message: "Couldn’t read an expense amount. Try “Fuel 5k”.",
    };
  }
  const txn_ids: string[] = [];
  for (const line of lines) {
    const result = await commitExpense({
      amount: line.amount,
      category: line.category,
      note: raw_text,
    });
    txn_ids.push(result.txn_id);
  }
  return { ok: true, kind: "expense", txn_ids };
}

async function commitRestockFromCapture(
  parsed: ParseResult | null,
  raw_text: string,
): Promise<CaptureOutcome> {
  const hint = restockHintFrom(parsed, raw_text);
  if (!hint) {
    return {
      ok: false,
      kind: "error",
      message: "Couldn’t read a restock qty. Try “Restocked 20 Ankara”.",
    };
  }

  const skus = await db.inventory.toArray();
  const matched = matchParsedItemToSku(
    {
      product_id: hint.sku_id ?? "",
      product_name: hint.product_name,
      quantity: hint.qty,
    },
    skus,
  );

  if (!matched) {
    return {
      ok: false,
      kind: "needs_restock_sheet",
      pending: {
        qty: hint.qty,
        total_cost: hint.total_cost,
        product_name: hint.product_name,
      },
    };
  }

  const result = await commitRestock({
    sku_id: matched.sku_id,
    qty: hint.qty,
    total_cost: hint.total_cost,
  });
  return {
    ok: true,
    kind: "restock",
    sku_id: result.sku_id,
    qty: result.qty,
    txn_id: result.txn_id,
  };
}

async function savePendingOrder(
  parsed: ParseResult | null,
  raw_text: string,
  capture_method: CaptureTextInput["capture_method"],
): Promise<CaptureOutcome> {
  const draft = () =>
    createPendingDraft({
      raw_text,
      capture_method,
    });

  if (!parsed || parsed.kind !== "order") {
    const order = await draft();
    if (!parsed) {
      await enqueueParse({
        order_id: order.order_id,
        raw_text,
        capture_method,
      });
    }
    return { ok: true, kind: "order", order };
  }

  const skus = await db.inventory.toArray();
  const matched = matchParsedItemsToSkus(parsed.items, skus);
  if (matched.length === 0) {
    return { ok: true, kind: "order", order: await draft() };
  }

  const order = await createPendingOrder({
    customer_name: parsed.customer_name.trim(),
    items: matched,
    delivery_address: parsed.delivery_address,
    capture_method,
    intent_classification: parsed.intent_classification,
    payment_signal_detected: parsed.payment_signal_detected,
    suggested_status: parsed.suggested_status,
    raw_text,
  });
  return { ok: true, kind: "order", order };
}

function expenseLinesFrom(
  parsed: ParseResult | null,
  raw_text: string,
): Array<{ amount: number; category: string }> {
  const fromParse: Array<{ amount: number; category: string }> = [];
  if (parsed?.expenses?.length) {
    for (const row of parsed.expenses) {
      if (row.amount > 0) {
        fromParse.push({
          amount: row.amount,
          category: row.category.trim() || "Expense",
        });
      }
    }
  } else if (parsed?.amount && parsed.amount > 0) {
    fromParse.push({
      amount: parsed.amount,
      category: parsed.category?.trim() || "Expense",
    });
  }
  if (fromParse.length > 0) return fromParse;
  return extractExpenseLines(raw_text);
}

function restockHintFrom(
  parsed: ParseResult | null,
  raw_text: string,
): CaptureRestockPending | null {
  const local = extractRestockHint(raw_text);
  const item = parsed?.items?.[0];
  const qty = parsed?.qty ?? item?.quantity ?? local?.qty;
  if (!qty || qty < 1) return null;
  const product_name =
    parsed?.sku_hint?.trim() ||
    item?.product_name?.trim() ||
    local?.product_name ||
    "";
  const total_cost = parsed?.total_cost ?? local?.total_cost ?? 0;
  const sku_id = item?.product_id?.trim() || undefined;
  return {
    qty,
    total_cost: total_cost >= 0 ? total_cost : 0,
    product_name,
    sku_id,
  };
}

/** 5k → 5000, 1.5k → 1500, 5,000 → 5000 */
export function nairaFromPhrase(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/₦/g, "").replace(/,/g, "").trim();
  if (!t) return null;
  const k = t.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (k) {
    const n = Number(k[1]) * 1000;
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function extractExpenseLines(
  text: string,
): Array<{ amount: number; category: string }> {
  const lines: Array<{ amount: number; category: string }> = [];
  const seen = new Set<string>();
  const re =
    /([A-Za-z][A-Za-z+'’-]*)\s+(?:₦\s*)?(\d+(?:[.,]\d+)?\s*k|\d[\d,]*\.?\d*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (NOISE_CATEGORY.test(match[1])) continue;
    const amount = nairaFromPhrase(match[2]);
    if (!amount || amount <= 0) continue;
    const key = `${match[1].toLowerCase()}:${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ amount, category: titleCase(match[1]) });
  }
  if (lines.length > 0) return lines;

  const loose = text.match(/(\d+(?:\.\d+)?\s*k|\d[\d,]+)/i);
  if (!loose) return [];
  const amount = nairaFromPhrase(loose[1]);
  if (!amount || amount <= 0) return [];
  const cat = text.match(
    /\b(fuel|nylon|transport|fare|data|airtime|generator|packaging)\b/i,
  );
  return [{ amount, category: cat ? titleCase(cat[1]) : "Expense" }];
}

export function extractRestockHint(
  text: string,
): CaptureRestockPending | null {
  const re =
    /\b(?:restocked|restock|received|added)\s+(\d+)\s+(?:pcs\s+|pieces\s+|of\s+)?(.+)/i;
  const match = text.match(re);
  if (!match) return null;
  const qty = Number(match[1]);
  if (!Number.isInteger(qty) || qty < 1) return null;
  let product = match[2].trim();
  let total_cost = 0;
  const forCost = product.match(/\s+for\s+(.+)$/i);
  if (forCost) {
    const parsedCost = nairaFromPhrase(forCost[1]);
    if (parsedCost && parsedCost > 0) total_cost = parsedCost;
    product = product.slice(0, forCost.index).trim();
  }
  product = product.replace(/[.,;]+$/g, "").trim();
  return { qty, total_cost, product_name: product };
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
