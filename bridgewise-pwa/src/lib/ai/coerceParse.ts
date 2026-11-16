import type {
  CaptureMethod,
  IntentClassification,
  OrderLine,
  ParseExpenseLine,
  ParseKind,
  ParseResult,
  SuggestedConfirmStatus,
} from "@/types/bridgewise";

/**
 * Force parse payloads onto the window-shopper contract.
 * Model JSON (or a hostile body) cannot confirm a sale or mark the
 * ledger committed. Pure: no Dexie, no inventory, no ledger writes.
 */
export function coerceParseResult(
  raw: unknown,
  capture_method: CaptureMethod,
): ParseResult {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const kind = coerceKind(obj.kind);
  const payment_signal_detected =
    kind === "order" ? Boolean(obj.payment_signal_detected) : false;
  const intent_classification: IntentClassification =
    kind === "order" && obj.intent_classification === "HIGH_PURCHASE_INTENT"
      ? "HIGH_PURCHASE_INTENT"
      : "INQUIRY";

  const suggested_status: SuggestedConfirmStatus | undefined =
    kind === "order" &&
    (payment_signal_detected || obj.suggested_status === "READY_TO_CONFIRM")
      ? "READY_TO_CONFIRM"
      : undefined;

  const amount = asNonNegativeNumber(obj.amount);
  const qty = asPositiveInt(obj.qty);
  const total_cost = asNonNegativeNumber(obj.total_cost);
  const expenses = coerceExpenses(obj.expenses);

  return {
    kind,
    capture_method,
    customer_name: asTrimmedString(obj.customer_name),
    delivery_address: asTrimmedString(obj.delivery_address),
    items: coerceItems(obj.items),
    intent_classification,
    payment_signal_detected,
    ...(suggested_status ? { suggested_status } : {}),
    status: "PENDING_INQUIRY",
    ledger_committed: false,
    ...(amount !== null ? { amount } : {}),
    ...(asTrimmedString(obj.category)
      ? { category: asTrimmedString(obj.category) }
      : {}),
    ...(asTrimmedString(obj.note) ? { note: asTrimmedString(obj.note) } : {}),
    ...(qty !== null ? { qty } : {}),
    ...(total_cost !== null ? { total_cost } : {}),
    ...(asTrimmedString(obj.sku_hint)
      ? { sku_hint: asTrimmedString(obj.sku_hint) }
      : {}),
    ...(expenses.length > 0 ? { expenses } : {}),
  };
}

function coerceKind(raw: unknown): ParseKind {
  if (raw === "expense" || raw === "restock" || raw === "order") return raw;
  return "order";
}

function coerceExpenses(raw: unknown): ParseExpenseLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: ParseExpenseLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const amount = asNonNegativeNumber(item.amount);
    const category = asTrimmedString(item.category);
    if (amount === null || amount <= 0) continue;
    lines.push({ amount, category: category || "Expense" });
  }
  return lines;
}

function coerceItems(raw: unknown): OrderLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: OrderLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const product_name = asTrimmedString(item.product_name);
    const quantity = asPositiveInt(item.quantity);
    if (!product_name || quantity === null) continue;
    lines.push({
      product_id: asTrimmedString(item.product_id),
      product_name,
      quantity,
      unit_cost_price: 0,
      unit_selling_price: 0,
    });
  }
  return lines;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function asNonNegativeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
