import { matchParsedItemsToSkus } from "@/lib/ai/skuMatch";
import type {
  CaptureMethod,
  IntentClassification,
  LedgerEntryType,
  Order,
  OrderLine,
  OrderStatus,
  ParseResult,
  Sku,
  StockColor,
  SuggestedConfirmStatus,
} from "@/types/bridgewise";
import {
  preferResolvedAddress,
  preferResolvedName,
  resolveCustomerIdentity,
  walkInName,
} from "@/lib/ai/identity";
import { upsertCustomer } from "@/lib/db/customers";
import {
  db,
  nextOrderId,
  nextTxnId,
  skuId,
  toIdToken,
  todayDateKey,
} from "@/lib/db/dexie";

export type CreatePendingOrderInput = {
  customer_name: string;
  items: Array<{ product_id: string; quantity: number }>;
  delivery_address?: string;
  capture_method?: CaptureMethod;
  date_key?: string;
  created_at?: number;
  intent_classification?: IntentClassification;
  payment_signal_detected?: boolean;
  suggested_status?: SuggestedConfirmStatus;
  raw_text?: string;
};

/** Ghost pending older than this become EXPIRED. No stock or ledger writes. */
export const PENDING_TTL_MS = 72 * 60 * 60 * 1000;

/** Workspace remount plus this interval call `expireStalePendingOrders`. */
export const EXPIRE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export type CommitAbortReason = "out_of_stock" | "missing_sku" | "empty_items";

export type CommitOrderResult =
  | { ok: true; outcome: "committed"; order_id: string }
  | {
      ok: true;
      outcome: "noop";
      reason: "missing_order" | "already_committed" | "not_pending";
    }
  | {
      ok: false;
      outcome: "aborted";
      reason: CommitAbortReason;
      sku_id?: string;
    };

export type CreatePendingDraftInput = {
  raw_text: string;
  capture_method: Extract<CaptureMethod, "clipboard" | "whatsapp_share_sheet">;
  date_key?: string;
};

export type CancelOrderResult =
  | { ok: true; outcome: "cancelled"; order_id: string }
  | {
      ok: true;
      outcome: "noop";
      reason: "missing_order" | "not_pending" | "already_committed";
    };

export type ReturnOrderResult =
  | { ok: true; outcome: "refunded"; order_id: string }
  | {
      ok: true;
      outcome: "noop";
      reason: "missing_order" | "not_committed" | "already_refunded";
    }
  | {
      ok: false;
      outcome: "aborted";
      reason: "missing_sku";
      sku_id?: string;
    };

export class ConfirmAbortedError extends Error {
  readonly reason: CommitAbortReason;
  readonly sku_id?: string;

  constructor(reason: CommitAbortReason, sku_id?: string) {
    super(
      reason === "missing_sku"
        ? `SKU missing: ${sku_id ?? "unknown"}`
        : reason === "empty_items"
          ? "Unparsed chat — Confirm disabled until a product is matched."
          : `Out of stock: ${sku_id ?? "unknown"}`,
    );
    this.name = "ConfirmAbortedError";
    this.reason = reason;
    this.sku_id = sku_id;
  }
}

/** Header, then in-text self-ID, then Walk-in / Inquiry #NNN. */
export function customerNameFromRawText(raw: string, seq: number): string {
  return resolveCustomerIdentity(raw, seq).name;
}

export function stockColorFor(qty: number, threshold: number): StockColor {
  if (qty <= 0) return "RED";
  if (qty <= threshold) return "YELLOW";
  return "GREEN";
}

/**
 * Vendor threshold wins when higher. After a restock batch is known,
 * floor is 20% of that qty. Unknown batch keeps the stored threshold (default 4).
 */
export function effectiveLowStockThreshold(sku: {
  low_stock_threshold: number;
  last_restock_qty?: number;
}): number {
  const vendor = sku.low_stock_threshold;
  const batch = sku.last_restock_qty;
  if (typeof batch === "number" && batch > 0) {
    return Math.max(vendor, Math.ceil(0.2 * batch));
  }
  return vendor;
}

export function stockColorForSku(
  sku: Pick<Sku, "stock_qty" | "low_stock_threshold"> & {
    last_restock_qty?: number;
  },
): StockColor {
  return stockColorFor(sku.stock_qty, effectiveLowStockThreshold(sku));
}

/** Local midnight of `YYYY-MM-DD`, or the stamped `created_at`. */
export function orderCreatedAt(order: Pick<Order, "date_key" | "created_at">): number {
  if (typeof order.created_at === "number" && Number.isFinite(order.created_at)) {
    return order.created_at;
  }
  const [year, month, day] = order.date_key.split("-").map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day).getTime();
}

/**
 * PENDING_INQUIRY + uncommitted + age > 72h → EXPIRED.
 * Never touches inventory, ledger, or pocket. Skips committed / cancelled.
 */
export async function expireStalePendingOrders(
  now = Date.now(),
): Promise<number> {
  return db.transaction("rw", db.orders, async () => {
    const pending = await db.orders
      .where("status")
      .equals("PENDING_INQUIRY")
      .filter((order) => order.ledger_committed === false)
      .toArray();

    let expired = 0;
    for (const order of pending) {
      if (now - orderCreatedAt(order) <= PENDING_TTL_MS) continue;
      await db.orders.update(order.order_id, { status: "EXPIRED" });
      expired += 1;
    }
    return expired;
  });
}

function lastNDateKeys(n: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = 0; i < n; i += 1) {
    keys.push(
      todayDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)),
    );
  }
  return keys;
}

function confirmedQtyForSku(
  sku_id: string,
  orders: Order[],
  dateKeys: Set<string>,
): number {
  let qty = 0;
  for (const order of orders) {
    if (!dateKeys.has(order.date_key)) continue;
    if (!order.ledger_committed || order.status !== "CONFIRMED_SALE") continue;
    for (const line of order.items) {
      if (line.product_id === sku_id) qty += line.quantity;
    }
  }
  return qty;
}

/** Confirmed (non-refunded) line qty over the last 7 local date_keys, / 7, rounded up. */
export function sevenDayVelocityFromOrders(
  sku_id: string,
  orders: Order[],
  now = new Date(),
): number {
  const keys = lastNDateKeys(7, now);
  return Math.ceil(confirmedQtyForSku(sku_id, orders, new Set(keys)) / 7);
}

export async function sevenDayVelocity(
  sku_id: string,
  now = new Date(),
): Promise<number> {
  const keys = lastNDateKeys(7, now);
  const orders = await db.orders.where("date_key").anyOf(keys).toArray();
  return sevenDayVelocityFromOrders(sku_id, orders, now);
}

export type CreateSkuInput = {
  name: string;
  variant: string;
  unit_cost_price: number;
  unit_selling_price: number;
  low_stock_threshold: number;
  initial_qty: number;
  product_type?: "reseller" | "maker";
  batch_cost?: number | null;
  batch_qty?: number | null;
};

export type UpdateSkuInput = {
  sku_id: string;
  name: string;
  unit_cost_price: number;
  unit_selling_price: number;
  low_stock_threshold: number;
  product_type?: "reseller" | "maker";
  batch_cost?: number | null;
  batch_qty?: number | null;
};

function assertMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be 0 or more`);
  }
}

function assertPositiveMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be more than 0`);
  }
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole number of 0 or more`);
  }
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a whole number of 1 or more`);
  }
}

/**
 * Create-time catalog write. Initial qty is allowed here only.
 * Later counts move solely via confirm / return / restock.
 */
export async function createSku(input: CreateSkuInput): Promise<Sku> {
  const name = input.name.trim();
  const variant = input.variant.trim();
  if (!name) throw new Error("Name is required");
  if (!variant) throw new Error("Variant is required");
  if (!toIdToken(name) || !toIdToken(variant)) {
    throw new Error("Name and variant need letters or numbers");
  }
  assertMoney(input.unit_cost_price, "Cost");
  assertMoney(input.unit_selling_price, "Sell");
  assertNonNegativeInt(input.low_stock_threshold, "Threshold");
  assertNonNegativeInt(input.initial_qty, "Initial quantity");

  const sku_id = skuId(name, variant);
  const existing = await db.inventory.get(sku_id);
  if (existing) {
    throw new Error(`SKU already exists: ${sku_id}`);
  }

  const sku: Sku = {
    sku_id,
    display_name: name,
    stock_qty: input.initial_qty,
    low_stock_threshold: input.low_stock_threshold,
    unit_cost_price: input.unit_cost_price,
    unit_selling_price: input.unit_selling_price,
    status_color: stockColorForSku({
      stock_qty: input.initial_qty,
      low_stock_threshold: input.low_stock_threshold,
    }),
    ...(input.product_type ? { product_type: input.product_type } : {}),
    ...(input.batch_cost != null ? { batch_cost: input.batch_cost } : {}),
    ...(input.batch_qty != null ? { batch_qty: input.batch_qty } : {}),
  };
  await db.inventory.add(sku);
  return sku;
}

/**
 * Edit catalog fields. Never accepts stock_qty — that would bypass the engine.
 * Recomputes the badge if threshold changed.
 */
export async function updateSku(input: UpdateSkuInput): Promise<Sku> {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  assertMoney(input.unit_cost_price, "Cost");
  assertMoney(input.unit_selling_price, "Sell");
  assertNonNegativeInt(input.low_stock_threshold, "Threshold");

  const existing = await db.inventory.get(input.sku_id);
  if (!existing) {
    throw new Error(`SKU missing: ${input.sku_id}`);
  }

  const next: Sku = {
    ...existing,
    display_name: name,
    unit_cost_price: input.unit_cost_price,
    unit_selling_price: input.unit_selling_price,
    low_stock_threshold: input.low_stock_threshold,
    status_color: stockColorForSku({
      stock_qty: existing.stock_qty,
      low_stock_threshold: input.low_stock_threshold,
      last_restock_qty: existing.last_restock_qty,
    }),
    ...(input.product_type ? { product_type: input.product_type } : { product_type: undefined }),
    batch_cost: input.batch_cost ?? null,
    batch_qty: input.batch_qty ?? null,
  };
  await db.inventory.put(next);
  return next;
}

async function nextOrderSeq(dateKey: string): Promise<number> {
  const rows = await db.orders.where("date_key").equals(dateKey).toArray();
  return rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
}

async function nextLedgerSeq(
  dateKey: string,
  type: LedgerEntryType,
): Promise<number> {
  const rows = await db.ledger_entries
    .where("date_key")
    .equals(dateKey)
    .filter((entry) => entry.entry_type === type)
    .toArray();
  let max = 0;
  for (const row of rows) {
    const parts = row.txn_id.split("_");
    const parsed = Number(parts[parts.length - 1]);
    if (Number.isFinite(parsed)) max = Math.max(max, parsed);
  }
  return max + 1;
}

/**
 * Sum SALE / EXPENSE / RESTOCK / RETURN for the day into the pocket buckets.
 * RESTOCK cash-out joins `total_expenses` (goods bought); it is never a SALE.
 * `net_profit = sales − protected_capital − total_expenses`.
 */
export async function recalculateDailyPocketStatement(
  dateKey: string,
): Promise<void> {
  const entries = await db.ledger_entries
    .where("date_key")
    .equals(dateKey)
    .toArray();

  let total_sales = 0;
  let total_expenses = 0;
  let protected_capital = 0;

  for (const entry of entries) {
    switch (entry.entry_type) {
      case "SALE":
        total_sales += entry.gross_amount;
        protected_capital += entry.capital_portion;
        break;
      case "EXPENSE":
        total_expenses += entry.gross_amount;
        break;
      case "RETURN":
        total_sales -= entry.gross_amount;
        protected_capital -= entry.capital_portion;
        break;
      case "RESTOCK":
        total_expenses += entry.gross_amount;
        break;
    }
  }

  await db.daily_statements.put({
    date_key: dateKey,
    total_sales,
    total_expenses,
    protected_capital,
    net_profit: total_sales - protected_capital - total_expenses,
  });
}

export type CommitExpenseInput = {
  amount: number;
  category?: string;
  note?: string;
  date_key?: string;
};

/**
 * Cash-out that is not inventory. Writes EXPENSE, recalculates the pocket.
 * Never touches SKU qty and never inserts SALE.
 */
export async function commitExpense(
  input: CommitExpenseInput,
): Promise<{ txn_id: string; date_key: string }> {
  assertPositiveMoney(input.amount, "Amount");
  const dateKey = input.date_key ?? todayDateKey();
  const category = input.category?.trim() ?? "";
  const note = input.note?.trim() ?? "";

  return db.transaction(
    "rw",
    [db.ledger_entries, db.daily_statements],
    async () => {
      const txnSeq = await nextLedgerSeq(dateKey, "EXPENSE");
      const txn_id = nextTxnId(dateKey, "EXPENSE", txnSeq);
      await db.ledger_entries.add({
        txn_id,
        date_key: dateKey,
        entry_type: "EXPENSE",
        gross_amount: input.amount,
        capital_portion: 0,
        net_profit_portion: 0,
        ...(category ? { category } : {}),
        ...(note ? { note } : {}),
      });
      await recalculateDailyPocketStatement(dateKey);
      return { txn_id, date_key: dateKey };
    },
  );
}

export type CommitRestockInput = {
  sku_id: string;
  qty: number;
  total_cost: number;
  date_key?: string;
  batch_cost?: number;
  batch_qty?: number;
};

/**
 * Supplier delivery. Adds qty, optional last-cost, RESTOCK ledger, recalc.
 * Never inserts SALE. Missing SKU aborts the whole Dexie transaction.
 */
export async function commitRestock(
  input: CommitRestockInput,
): Promise<{ txn_id: string; sku_id: string; qty: number }> {
  assertPositiveInt(input.qty, "Qty");
  assertMoney(input.total_cost, "Total cost");
  const dateKey = input.date_key ?? todayDateKey();

  return db.transaction(
    "rw",
    [db.inventory, db.ledger_entries, db.daily_statements],
    async () => {
      const sku = await db.inventory.get(input.sku_id);
      if (!sku) {
        throw new Error(`SKU missing: ${input.sku_id}`);
      }

      const nextQty = sku.stock_qty + input.qty;
      const unitCost =
        input.total_cost > 0 ? input.total_cost / input.qty : null;
      const lastCostValid =
        unitCost !== null && Number.isFinite(unitCost) && unitCost > 0;

      await db.inventory.update(sku.sku_id, {
        stock_qty: nextQty,
        last_restock_qty: input.qty,
        status_color: stockColorForSku({
          stock_qty: nextQty,
          low_stock_threshold: sku.low_stock_threshold,
          last_restock_qty: input.qty,
        }),
        ...(lastCostValid ? { unit_cost_price: unitCost } : {}),
        ...(input.batch_cost != null ? { batch_cost: input.batch_cost } : {}),
        ...(input.batch_qty != null ? { batch_qty: input.batch_qty } : {}),
      });

      const txnSeq = await nextLedgerSeq(dateKey, "RESTOCK");
      const txn_id = nextTxnId(dateKey, "RESTOCK", txnSeq);
      await db.ledger_entries.add({
        txn_id,
        date_key: dateKey,
        entry_type: "RESTOCK",
        gross_amount: input.total_cost,
        capital_portion: 0,
        net_profit_portion: 0,
        ref_sku_id: sku.sku_id,
      });
      await recalculateDailyPocketStatement(dateKey);
      return { txn_id, sku_id: sku.sku_id, qty: input.qty };
    },
  );
}

/**
 * Pending create only. Copies SKU prices onto lines. Never writes inventory or ledger.
 */
export async function createPendingOrder(
  input: CreatePendingOrderInput,
): Promise<Order> {
  if (input.items.length === 0) {
    throw new Error("createPendingOrder requires at least one line");
  }

  const dateKey = input.date_key ?? todayDateKey();
  const lines: OrderLine[] = [];

  for (const item of input.items) {
    const sku = await db.inventory.get(item.product_id);
    if (!sku) {
      throw new Error(`Cannot create pending order: SKU ${item.product_id} is missing`);
    }
    lines.push({
      product_id: sku.sku_id,
      product_name: sku.display_name,
      quantity: item.quantity,
      unit_cost_price: sku.unit_cost_price,
      unit_selling_price: sku.unit_selling_price,
    });
  }

  return db.transaction("rw", [db.orders, db.customers], async () => {
    const seq = await nextOrderSeq(dateKey);
    const { customer_name, delivery_address } = resolveOrderIdentity(
      seq,
      input.customer_name,
      input.delivery_address ?? "",
      input.raw_text,
    );
    const order: Order = {
      order_id: nextOrderId(customer_name, dateKey, seq),
      customer_name,
      items: lines,
      delivery_address,
      status: "PENDING_INQUIRY",
      ledger_committed: false,
      capture_method: input.capture_method ?? "manual",
      date_key: dateKey,
      seq,
      created_at: input.created_at ?? Date.now(),
      ...(input.intent_classification
        ? { intent_classification: input.intent_classification }
        : {}),
      ...(input.payment_signal_detected !== undefined
        ? { payment_signal_detected: input.payment_signal_detected }
        : {}),
      ...(input.suggested_status
        ? { suggested_status: input.suggested_status }
        : {}),
      ...(input.raw_text?.trim() ? { raw_text: input.raw_text.trim() } : {}),
    };
    await db.orders.add(order);
    await upsertCustomer({ name: customer_name, address: delivery_address });
    return order;
  });
}

/**
 * Clipboard / share-target capture. Writes a pending order and upserts the
 * customer directory when a real name is resolved. Empty items, raw_text,
 * PENDING_INQUIRY, ledger_committed false. Never touches inventory or ledger.
 * navigator.onLine does not block — Dexie is local.
 */
export async function createPendingDraft(
  input: CreatePendingDraftInput,
): Promise<Order> {
  const raw = input.raw_text.trim();
  if (!raw) {
    throw new Error("createPendingDraft requires chat text");
  }
  if (
    input.capture_method !== "clipboard" &&
    input.capture_method !== "whatsapp_share_sheet"
  ) {
    throw new Error(
      "createPendingDraft capture_method must be clipboard or whatsapp_share_sheet",
    );
  }

  const dateKey = input.date_key ?? todayDateKey();

  return db.transaction("rw", [db.orders, db.customers], async () => {
    const seq = await nextOrderSeq(dateKey);
    const identity = resolveCustomerIdentity(raw, seq);
    const customer_name = identity.name;
    const delivery_address = identity.address;
    const order: Order = {
      order_id: nextOrderId(customer_name, dateKey, seq),
      customer_name,
      items: [],
      delivery_address,
      status: "PENDING_INQUIRY",
      ledger_committed: false,
      capture_method: input.capture_method,
      date_key: dateKey,
      seq,
      created_at: Date.now(),
      raw_text: raw,
      intent_classification: "INQUIRY",
    };
    await db.orders.add(order);
    await upsertCustomer({ name: customer_name, address: delivery_address });
    return order;
  });
}

/**
 * Apply a successful /api/parse payload onto an existing pending draft.
 * Same `order_id`. Never confirms, never writes inventory or ledger.
 */
export async function applyParseToPendingOrder(
  orderId: string,
  parsed: ParseResult,
): Promise<void> {
  if (parsed.kind !== "order") return;
  if (parsed.ledger_committed || parsed.status !== "PENDING_INQUIRY") return;

  await db.transaction(
    "rw",
    [db.orders, db.inventory, db.customers],
    async () => {
      const order = await db.orders.get(orderId);
      if (!order) return;
      if (order.ledger_committed) return;
      if (order.status !== "PENDING_INQUIRY") return;

      const skus = await db.inventory.toArray();
      const matched = matchParsedItemsToSkus(parsed.items, skus);
      if (matched.length === 0) return;

      const lines: OrderLine[] = [];
      for (const item of matched) {
        const sku = await db.inventory.get(item.product_id);
        if (!sku) {
          throw new Error(`Cannot apply parse: SKU ${item.product_id} is missing`);
        }
        lines.push({
          product_id: sku.sku_id,
          product_name: sku.display_name,
          quantity: item.quantity,
          unit_cost_price: sku.unit_cost_price,
          unit_selling_price: sku.unit_selling_price,
        });
      }

      const { customer_name, delivery_address } = resolveOrderIdentity(
        order.seq,
        parsed.customer_name,
        parsed.delivery_address,
        order.raw_text,
      );

      await db.orders.update(order.order_id, {
        customer_name,
        delivery_address,
        items: lines,
        intent_classification: parsed.intent_classification,
        payment_signal_detected: parsed.payment_signal_detected,
        ...(parsed.suggested_status
          ? { suggested_status: parsed.suggested_status }
          : {}),
      });
      await upsertCustomer({ name: customer_name, address: delivery_address });
    },
  );
}

function resolveOrderIdentity(
  seq: number,
  fallbackName: string,
  fallbackAddress: string,
  rawText?: string,
): { customer_name: string; delivery_address: string } {
  const raw = rawText?.trim() ?? "";
  if (!raw) {
    const name = fallbackName.trim() || walkInName(seq);
    return { customer_name: name, delivery_address: fallbackAddress.trim() };
  }
  const resolved = resolveCustomerIdentity(raw, seq);
  return {
    customer_name: preferResolvedName(resolved, fallbackName),
    delivery_address: preferResolvedAddress(resolved, fallbackAddress),
  };
}

/**
 * Confirm Sale. The only path that may deduct stock and book ₦.
 * Idempotent: missing order or ledger_committed → no-op.
 * OOS / missing SKU / empty draft aborts the whole Dexie transaction (no partial deduct).
 */
export async function commitConfirmedOrder(
  orderId: string,
): Promise<CommitOrderResult> {
  try {
    return await db.transaction(
      "rw",
      [db.orders, db.inventory, db.ledger_entries, db.daily_statements],
      async () => {
        const order = await db.orders.get(orderId);
        if (!order) {
          return { ok: true, outcome: "noop", reason: "missing_order" };
        }
        if (order.ledger_committed) {
          return { ok: true, outcome: "noop", reason: "already_committed" };
        }
        if (order.status !== "PENDING_INQUIRY") {
          return { ok: true, outcome: "noop", reason: "not_pending" };
        }
        if (order.items.length === 0) {
          throw new ConfirmAbortedError("empty_items");
        }

        const needed = new Map<string, { sku: Sku; quantity: number }>();
        let gross = 0;
        let capital = 0;

        for (const line of order.items) {
          const sku = await db.inventory.get(line.product_id);
          if (!sku) {
            throw new ConfirmAbortedError("missing_sku", line.product_id);
          }
          const current = needed.get(sku.sku_id);
          if (current) {
            current.quantity += line.quantity;
          } else {
            needed.set(sku.sku_id, { sku, quantity: line.quantity });
          }
          gross += line.unit_selling_price * line.quantity;
          capital += line.unit_cost_price * line.quantity;
        }

        for (const { sku, quantity } of needed.values()) {
          if (sku.stock_qty < quantity) {
            throw new ConfirmAbortedError("out_of_stock", sku.sku_id);
          }
        }

        for (const { sku, quantity } of needed.values()) {
          const nextQty = sku.stock_qty - quantity;
          await db.inventory.update(sku.sku_id, {
            stock_qty: nextQty,
            status_color: stockColorForSku({
              ...sku,
              stock_qty: nextQty,
            }),
          });
        }

        const txnSeq = await nextLedgerSeq(order.date_key, "SALE");
        await db.ledger_entries.add({
          txn_id: nextTxnId(order.date_key, "SALE", txnSeq),
          date_key: order.date_key,
          ref_order_id: order.order_id,
          entry_type: "SALE",
          gross_amount: gross,
          capital_portion: capital,
          net_profit_portion: gross - capital,
          created_at: Date.now(),
        });

        await db.orders.update(order.order_id, {
          status: "CONFIRMED_SALE",
          ledger_committed: true,
        });

        await recalculateDailyPocketStatement(order.date_key);

        return { ok: true, outcome: "committed", order_id: order.order_id };
      },
    );
  } catch (error) {
    const aborted = asConfirmAborted(error);
    if (aborted) {
      return {
        ok: false,
        outcome: "aborted",
        reason: aborted.reason,
        sku_id: aborted.sku_id,
      };
    }
    throw error;
  }
}

function asConfirmAborted(error: unknown): ConfirmAbortedError | null {
  if (error instanceof ConfirmAbortedError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "ConfirmAbortedError"
  ) {
    return error as ConfirmAbortedError;
  }
  return null;
}

/** Status only. Pending + uncommitted → CANCELLED. No stock or ledger writes. */
export async function cancelOrArchiveOrder(
  orderId: string,
): Promise<CancelOrderResult> {
  return db.transaction("rw", db.orders, async () => {
    const order = await db.orders.get(orderId);
    if (!order) {
      return { ok: true, outcome: "noop", reason: "missing_order" };
    }
    if (order.ledger_committed) {
      return { ok: true, outcome: "noop", reason: "already_committed" };
    }
    if (order.status !== "PENDING_INQUIRY") {
      return { ok: true, outcome: "noop", reason: "not_pending" };
    }
    await db.orders.update(order.order_id, { status: "CANCELLED" });
    return { ok: true, outcome: "cancelled", order_id: order.order_id };
  });
}

/**
 * Restore qty, write RETURN ledger, recalc statement. Skip if already REFUNDED.
 */
export async function processReturn(
  orderId: string,
): Promise<ReturnOrderResult> {
  try {
    return await db.transaction(
      "rw",
      [db.orders, db.inventory, db.ledger_entries, db.daily_statements],
      async () => {
        const order = await db.orders.get(orderId);
        if (!order) {
          return { ok: true, outcome: "noop", reason: "missing_order" };
        }
        if (order.status === "REFUNDED") {
          return { ok: true, outcome: "noop", reason: "already_refunded" };
        }
        if (!order.ledger_committed || order.status !== "CONFIRMED_SALE") {
          return { ok: true, outcome: "noop", reason: "not_committed" };
        }

        const restore = new Map<string, { sku: Sku; quantity: number }>();
        let gross = 0;
        let capital = 0;

        for (const line of order.items) {
          const sku = await db.inventory.get(line.product_id);
          if (!sku) {
            throw new ConfirmAbortedError("missing_sku", line.product_id);
          }
          const current = restore.get(sku.sku_id);
          if (current) {
            current.quantity += line.quantity;
          } else {
            restore.set(sku.sku_id, { sku, quantity: line.quantity });
          }
          gross += line.unit_selling_price * line.quantity;
          capital += line.unit_cost_price * line.quantity;
        }

        for (const { sku, quantity } of restore.values()) {
          const nextQty = sku.stock_qty + quantity;
          await db.inventory.update(sku.sku_id, {
            stock_qty: nextQty,
            status_color: stockColorForSku({
              ...sku,
              stock_qty: nextQty,
            }),
          });
        }

        const txnSeq = await nextLedgerSeq(order.date_key, "RETURN");
        await db.ledger_entries.add({
          txn_id: nextTxnId(order.date_key, "RETURN", txnSeq),
          date_key: order.date_key,
          ref_order_id: order.order_id,
          entry_type: "RETURN",
          gross_amount: gross,
          capital_portion: capital,
          net_profit_portion: gross - capital,
        });

        await db.orders.update(order.order_id, { status: "REFUNDED" });
        await recalculateDailyPocketStatement(order.date_key);

        return { ok: true, outcome: "refunded", order_id: order.order_id };
      },
    );
  } catch (error) {
    const aborted = asConfirmAborted(error);
    if (aborted?.reason === "missing_sku") {
      return {
        ok: false,
        outcome: "aborted",
        reason: "missing_sku",
        sku_id: aborted.sku_id,
      };
    }
    throw error;
  }
}

/** Statuses that may never be hard-deleted (they carry committed ledger entries). */
const PROTECTED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "CONFIRMED_SALE",
  "REFUNDED",
]);

export type DeleteOrdersResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: "protected_rows" };

/**
 * Hard-deletes orders by ID in a single transaction.
 * Refuses the entire batch if any order has a protected status.
 * Does NOT touch ledger_entries or inventory — only call for
 * PENDING_INQUIRY / CANCELLED / EXPIRED rows.
 */
export async function deleteOrders(
  orderIds: string[],
): Promise<DeleteOrdersResult> {
  return db.transaction("rw", db.orders, async () => {
    const rows = await db.orders.bulkGet(orderIds);
    for (const row of rows) {
      if (!row) continue;
      if (PROTECTED_STATUSES.has(row.status)) {
        return { ok: false, reason: "protected_rows" };
      }
    }
    await db.orders.bulkDelete(orderIds);
    return { ok: true, deleted: orderIds.length };
  });
}
