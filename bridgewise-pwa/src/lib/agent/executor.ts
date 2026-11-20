import { db, skuId, todayDateKey } from "@/lib/db/dexie";
import { fuzzyFindSkus } from "@/lib/agent/fuzzy";
import { APPROVAL_TOOLS, TOOL_BY_NAME } from "@/lib/agent/toolDefs";
import type { ChatCard } from "@/lib/agent/types";
import { buildCustomerIndex, findCustomerIn, normName } from "@/lib/db/customerMatch";
import { searchCustomers } from "@/lib/db/customerSearch";
import { saveCustomerPhone, setCustomerPhone } from "@/lib/db/customers";
import {
  cancelOrArchiveOrder,
  commitConfirmedOrder,
  commitExpense,
  commitRestock,
  createPendingOrder,
  createSku,
  deleteOrders,
  processReturn,
  restorePendingOrder,
  updatePendingOrder,
  updateSku,
} from "@/lib/db/transactions";
import { formatMoney } from "@/lib/receipt/helpers";
import { buildSaleLines, shiftDateKey, summarise, PERIOD_DAYS, type Period } from "@/lib/stats/productStats";
import { isWalkInName } from "@/lib/ai/identity";
import type { Order, Sku } from "@/types/bridgewise";

/**
 * Runs the assistant's tools on the phone.
 *
 * The rule enforced here, in code and not in the prompt:
 *  - `run()` is the only entry the model can reach. For an approval tool it
 *    NEVER executes. It validates, then returns a proposal (a card).
 *  - Approval tools execute only through `approve()`, which the vendor's tap
 *    on that exact card calls. Approval is one-time and bound to the tool and
 *    arguments that were shown on the card.
 *  - Every write goes through the existing transaction functions, so their
 *    guards still apply (out-of-stock, idempotent confirm, pending-only delete).
 */

export type ToolOutcome = {
  /** What the model sees. Compact. */
  response: Record<string, unknown>;
  card?: ChatCard;
  cards?: ChatCard[];
  /** Short progress line for the vendor, e.g. "Checking stock...". */
  progress: string;
};

type Args = Record<string, unknown>;

type Proposal = {
  id: string;
  tool: string;
  args: Args;
  /** Resolved, validated arguments. This is what runs. */
  plan: Plan;
  used: boolean;
};

type Plan =
  | { kind: "confirm_sale"; order_id: string }
  | { kind: "cancel_order"; order_id: string }
  | { kind: "delete_orders"; order_ids: string[] }
  | { kind: "process_return"; order_id: string }
  | { kind: "log_restock"; sku_id: string; qty: number; total_cost: number }
  | { kind: "log_expense"; amount: number; category: string; note: string }
  | {
      kind: "create_product";
      name: string;
      variant: string;
      cost: number;
      price: number;
      qty: number;
    }
  | { kind: "update_product"; sku_id: string; name?: string; cost?: number; price?: number };

type ApprovalToken = { readonly proposalId: string; readonly tool: string; readonly key: string };

const STATUS_WORDS: Record<string, string> = {
  PENDING_INQUIRY: "Not paid yet",
  CONFIRMED_SALE: "Sold",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  REFUNDED: "Returned",
};

const STATUS_FILTER: Record<string, string> = {
  pending: "PENDING_INQUIRY",
  sold: "CONFIRMED_SALE",
  cancelled: "CANCELLED",
  expired: "EXPIRED",
  refunded: "REFUNDED",
};

/** Only these may be hard-deleted through the assistant. */
const DELETABLE = new Set(["PENDING_INQUIRY", "CANCELLED"]);

const MAX_LIST = 12;

function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function numOrNaN(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return NaN;
}
function keyOf(tool: string, plan: Plan): string {
  return `${tool}:${JSON.stringify(plan)}`;
}

function orderTotal(o: Order): number {
  return o.items.reduce((s, l) => s + l.unit_selling_price * l.quantity, 0);
}
function lineText(o: Order): string {
  return o.items.length
    ? o.items.map((l) => `${l.quantity} × ${l.product_name}`).join(", ")
    : "Nothing picked out yet";
}
function who(o: Order): string {
  return isWalkInName(o.customer_name) ? "a customer" : o.customer_name;
}

function orderForModel(o: Order) {
  return {
    order_ref: o.order_id,
    customer: o.customer_name,
    status: STATUS_WORDS[o.status] ?? o.status,
    items: o.items.map((l) => ({ product: l.product_name, quantity: l.quantity, price: l.unit_selling_price })),
    total: orderTotal(o),
    date: o.date_key,
    address: o.delivery_address || undefined,
    customer_says_paid: o.payment_signal_detected || undefined,
  };
}

function orderCard(o: Order, state?: ChatCard["state"]): ChatCard {
  return {
    id: newId(),
    kind: "order",
    title: o.customer_name,
    lines: [
      lineText(o),
      `${formatMoney(orderTotal(o))} · ${STATUS_WORDS[o.status] ?? o.status}`,
    ],
    open: { screen: "order", order_ref: o.order_id },
    ...(state ? { state } : {}),
  };
}

function skuCard(s: Sku): ChatCard {
  const low = s.stock_qty <= s.low_stock_threshold;
  return {
    id: newId(),
    kind: "stock",
    title: s.display_name,
    lines: [
      `${s.stock_qty} left${s.stock_qty === 0 ? " (finished)" : low ? " (low)" : ""}`,
      `Selling at ${formatMoney(s.unit_selling_price)}`,
    ],
    open: { screen: "stock" },
  };
}

function periodKeys(period: Period, today = todayDateKey()): string[] {
  const days = PERIOD_DAYS[period];
  return Array.from({ length: days }, (_, i) => shiftDateKey(today, -(days - 1 - i)));
}

function asPeriod(v: unknown): Period {
  return v === "week" || v === "month" ? v : "today";
}

export class ToolExecutor {
  #proposals = new Map<string, Proposal>();
  #tokens = new Set<ApprovalToken>();

  /** The only entry point for model-requested tools. Never runs an approval tool. */
  async run(name: string, rawArgs: unknown, cardId?: string): Promise<ToolOutcome> {
    const def = TOOL_BY_NAME.get(name);
    if (!def) {
      return { progress: "Thinking...", response: { error: "unknown_tool" } };
    }
    const args: Args =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Args)
        : {};
    try {
      if (def.level === "approval") {
        return await this.#propose(name, args, cardId);
      }
      return await this.#runSafe(name, args);
    } catch (e) {
      return {
        progress: "Working on it...",
        response: { error: e instanceof Error ? e.message : "tool_failed" },
      };
    }
  }

  /**
   * Called only by the Approve button on a card. Mints a one-time approval for
   * that card's own tool and arguments, then runs it through the same
   * functions as the existing buttons.
   */
  async approve(cardId: string, revive?: { tool: string; args: Args }): Promise<ToolOutcome> {
    let p = this.#proposals.get(cardId);
    if (!p && revive && APPROVAL_TOOLS.has(revive.tool)) {
      // Card restored from the chat store after a reload: rebuild it from the
      // saved request, re-checking everything against today's data.
      const built = await this.#plan(revive.tool, revive.args);
      if ("error" in built) {
        return { progress: "", response: { error: built.error, ok: false } };
      }
      p = { id: cardId, tool: revive.tool, args: revive.args, plan: built.plan, used: false };
      this.#proposals.set(cardId, p);
    }
    if (!p) return { progress: "", response: { ok: false, error: "card_expired" } };
    if (p.used) return { progress: "", response: { ok: false, error: "already_done" } };
    p.used = true;
    const token: ApprovalToken = { proposalId: p.id, tool: p.tool, key: keyOf(p.tool, p.plan) };
    this.#tokens.add(token);
    return this.#execute(p.tool, p.plan, token);
  }

  /** Vendor cancelled the card. Nothing runs. */
  cancel(cardId: string): void {
    const p = this.#proposals.get(cardId);
    if (p) p.used = true;
  }

  /** Undo for a safe write, from the card's Undo button. */
  async undo(card: ChatCard): Promise<{ ok: boolean; message: string }> {
    const u = card.undo;
    if (!u) return { ok: false, message: "Nothing to undo." };
    if (u.tool === "delete_pending") {
      const id = str(u.data.order_id);
      const o = await db.orders.get(id);
      if (!o) return { ok: true, message: "Already gone." };
      if (o.ledger_committed || o.status !== "PENDING_INQUIRY") {
        return { ok: false, message: "That order has moved on, so it cannot be undone here." };
      }
      const r = await deleteOrders([id]);
      return r.ok ? { ok: true, message: "Removed." } : { ok: false, message: "Could not remove it." };
    }
    if (u.tool === "restore_order") {
      const ok = await restorePendingOrder(u.data.snapshot as Order);
      return ok
        ? { ok: true, message: "Put back how it was." }
        : { ok: false, message: "That order has moved on, so it cannot be undone here." };
    }
    if (u.tool === "restore_phone") {
      const r = await saveCustomerPhone(str(u.data.customer_id), str(u.data.phone));
      return r === "no_customer"
        ? { ok: false, message: "Could not find that customer." }
        : { ok: true, message: "Put back how it was." };
    }
    return { ok: false, message: "Nothing to undo." };
  }

  // ---------------------------------------------------------------- safe tools

  async #runSafe(name: string, a: Args): Promise<ToolOutcome> {
    switch (name) {
      case "search_customers": {
        const rows = await searchCustomers(str(a.query), 6);
        return {
          progress: "Looking for the customer...",
          response: {
            customers: rows.map((r) => ({
              customer_ref: r.customer.customer_id,
              name: r.customer.name,
              phone: r.customer.phone ?? null,
              orders: r.orders,
              last_order: r.lastDate,
            })),
          },
          cards: rows.slice(0, 3).map((r) => ({
            id: newId(),
            kind: "customer" as const,
            title: r.customer.name,
            lines: [
              `${r.orders} order${r.orders === 1 ? "" : "s"}${r.lastDate ? ` · last ${r.lastDate}` : ""}`,
              r.customer.phone ? `Phone saved` : "No phone yet",
            ],
            open: { screen: "customer" as const, customer_ref: r.customer.customer_id },
          })),
        };
      }
      case "get_customer_history": {
        const c = await db.customers.get(str(a.customer_ref));
        if (!c) return { progress: "", response: { error: "customer_not_found" } };
        const [customers, orders] = await Promise.all([db.customers.toArray(), db.orders.toArray()]);
        const idx = buildCustomerIndex(customers);
        const mine = orders
          .filter((o) => idx.forOrder(o)?.customer_id === c.customer_id)
          .sort((x, y) => (y.created_at ?? 0) - (x.created_at ?? 0));
        const sold = mine.filter((o) => o.status === "CONFIRMED_SALE");
        const spend = sold.reduce((s, o) => s + orderTotal(o), 0);
        return {
          progress: "Opening their history...",
          response: {
            name: c.name,
            phone: c.phone ?? null,
            orders: mine.length,
            sold: sold.length,
            total_spent: spend,
            recent: mine.slice(0, 5).map(orderForModel),
          },
          card: {
            id: newId(),
            kind: "customer",
            title: c.name,
            lines: [
              `${sold.length} sold · ${formatMoney(spend)} spent`,
              `${mine.length} order${mine.length === 1 ? "" : "s"} in all`,
            ],
            open: { screen: "customer", customer_ref: c.customer_id },
          },
        };
      }
      case "list_orders": {
        let rows = await db.orders.toArray();
        const status = str(a.status) || "all";
        if (STATUS_FILTER[status]) rows = rows.filter((o) => o.status === STATUS_FILTER[status]);
        const cust = str(a.customer);
        if (cust) rows = rows.filter((o) => normName(o.customer_name).includes(normName(cust)));
        const date = str(a.date);
        if (date) rows = rows.filter((o) => o.date_key === (date === "today" ? todayDateKey() : date));
        rows.sort((x, y) => (y.created_at ?? 0) - (x.created_at ?? 0) || y.seq - x.seq);
        const limit = Math.min(MAX_LIST, Math.max(1, Math.trunc(numOrNaN(a.limit)) || 8));
        const shown = rows.slice(0, limit);
        return {
          progress: "Checking your orders...",
          response: { total: rows.length, orders: shown.map(orderForModel) },
          cards: shown.slice(0, 5).map((o) => orderCard(o)),
        };
      }
      case "get_order": {
        const o = await db.orders.get(str(a.order_ref));
        if (!o) return { progress: "", response: { error: "order_not_found" } };
        return { progress: "Opening the order...", response: orderForModel(o), card: orderCard(o) };
      }
      case "list_products": {
        const q = str(a.query);
        const skus = await db.inventory.toArray();
        const rows = q ? fuzzyFindSkus(q, skus).matches.map((m) => m.sku) : skus;
        return {
          progress: "Checking stock...",
          response: {
            products: rows.slice(0, 25).map((s) => ({
              product: s.display_name,
              in_stock: s.stock_qty,
              price: s.unit_selling_price,
            })),
          },
        };
      }
      case "get_stock": {
        const skus = await db.inventory.toArray();
        const r = fuzzyFindSkus(str(a.product), skus);
        if (r.matches.length === 0) {
          return { progress: "Checking stock...", response: { found: false } };
        }
        return {
          progress: "Checking stock...",
          response: {
            found: true,
            ambiguous: r.ambiguous,
            matches: r.matches.map((m) => ({
              product: m.sku.display_name,
              in_stock: m.sku.stock_qty,
              price: m.sku.unit_selling_price,
            })),
          },
          cards: r.matches.slice(0, 3).map((m) => skuCard(m.sku)),
        };
      }
      case "get_pocket_statement": {
        const period = asPeriod(a.period);
        const rows = await db.daily_statements.bulkGet(periodKeys(period));
        const sum = { sales: 0, capital: 0, expenses: 0, profit: 0 };
        for (const r of rows) {
          if (!r) continue;
          sum.sales += r.total_sales;
          sum.capital += r.protected_capital;
          sum.expenses += r.total_expenses;
          sum.profit += r.net_profit;
        }
        return {
          progress: "Counting your money...",
          response: { period, ...sum },
          card: {
            id: newId(),
            kind: "statement",
            title: period === "today" ? "Pocket Statement · today" : `Pocket Statement · ${period === "week" ? "7 days" : "30 days"}`,
            lines: [
              `Sales ${formatMoney(sum.sales)}`,
              `Protected capital ${formatMoney(sum.capital)}`,
              `Expenses ${formatMoney(sum.expenses)}`,
              `Profit ${formatMoney(sum.profit)}`,
            ],
            open: { screen: "statement" },
          },
        };
      }
      case "get_product_performance": {
        const period = asPeriod(a.period);
        const [entries, orders] = await Promise.all([
          db.ledger_entries.where("entry_type").equals("SALE").toArray(),
          db.orders.toArray(),
        ]);
        const s = summarise(buildSaleLines(entries, orders), period, todayDateKey());
        return {
          progress: "Checking what is selling...",
          response: {
            period,
            revenue: s.revenue,
            units: s.units,
            best_seller: s.bestSeller?.name ?? null,
            products: s.rows.slice(0, 6).map((r) => ({
              product: r.name,
              units: r.units,
              revenue: r.revenue,
              profit: r.profit,
            })),
          },
          card: {
            id: newId(),
            kind: "statement",
            title: "How your products are doing",
            lines: [
              `Sold ${formatMoney(s.revenue)} · ${s.units} item${s.units === 1 ? "" : "s"}`,
              s.bestSeller ? `Best seller: ${s.bestSeller.name}` : "No sales in this time yet",
            ],
            open: { screen: "stock" },
          },
        };
      }
      case "create_pending_order":
        return this.#createPending(a);
      case "update_pending_order":
        return this.#updatePending(a);
      case "save_customer_phone":
        return this.#savePhone(a);
      default:
        return { progress: "", response: { error: "unknown_tool" } };
    }
  }

  /** Product lines → SKUs, or a reason to ask the vendor. Never creates anything. */
  async #resolveItems(
    raw: unknown,
  ): Promise<
    | { ok: true; items: Array<{ product_id: string; quantity: number }> }
    | { ok: false; response: Record<string, unknown> }
  > {
    if (!Array.isArray(raw) || raw.length === 0) {
      return { ok: false, response: { error: "no_items", hint: "Ask which product and how many." } };
    }
    const skus = await db.inventory.toArray();
    const items: Array<{ product_id: string; quantity: number }> = [];
    const notFound: string[] = [];
    const ambiguous: Array<{ said: string; options: string[] }> = [];
    const noQty: string[] = [];
    for (const row of raw.slice(0, 20)) {
      const r = (row ?? {}) as Args;
      const said = str(r.product);
      const qty = numOrNaN(r.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        noQty.push(said || "an item");
        continue;
      }
      const m = fuzzyFindSkus(said, skus);
      if (m.matches.length === 0) notFound.push(said);
      else if (m.ambiguous) {
        ambiguous.push({ said, options: m.matches.map((x) => x.sku.display_name) });
      } else {
        const id = m.matches[0].sku.sku_id;
        const existing = items.find((i) => i.product_id === id);
        if (existing) existing.quantity += qty;
        else items.push({ product_id: id, quantity: qty });
      }
    }
    if (notFound.length || ambiguous.length || noQty.length) {
      return {
        ok: false,
        response: {
          created: false,
          not_in_stock_room: notFound,
          ambiguous,
          missing_quantity: noQty,
          hint: "Nothing was saved. Ask the vendor one short question. Never add a product silently.",
        },
      };
    }
    return { ok: true, items };
  }

  async #createPending(a: Args): Promise<ToolOutcome> {
    const resolved = await this.#resolveItems(a.items);
    if (!resolved.ok) return { progress: "Matching your products...", response: resolved.response };
    const says = a.customer_says_paid === true;
    const phone = str(a.customer_phone);
    // Forced fields: pending, uncommitted. The model cannot set these.
    const order = await createPendingOrder({
      customer_name: str(a.customer_name),
      items: resolved.items,
      delivery_address: str(a.delivery_address),
      ...(phone ? { customer_phone: phone } : {}),
      capture_method: "manual",
      intent_classification: says ? "HIGH_PURCHASE_INTENT" : "INQUIRY",
      payment_signal_detected: says,
      ...(says ? { suggested_status: "READY_TO_CONFIRM" as const } : {}),
    });
    const stockWarn: string[] = [];
    for (const l of order.items) {
      const s = await db.inventory.get(l.product_id);
      if (s && s.stock_qty < l.quantity) {
        stockWarn.push(`${s.display_name}: only ${s.stock_qty} left, wanted ${l.quantity}`);
      }
    }
    const card = orderCard(order);
    card.undo = { tool: "delete_pending", data: { order_id: order.order_id } };
    if (stockWarn.length) card.note = stockWarn.join(". ");
    return {
      progress: "Saving the enquiry...",
      response: {
        created: true,
        ...orderForModel(order),
        stock_warnings: stockWarn,
        note: "Saved as NOT PAID. Stock and money unchanged. Payment is not verified.",
      },
      card,
    };
  }

  async #updatePending(a: Args): Promise<ToolOutcome> {
    const id = str(a.order_ref);
    const existing = await db.orders.get(id);
    if (!existing) return { progress: "", response: { error: "order_not_found" } };
    let items: Array<{ product_id: string; quantity: number }> | undefined;
    if (a.items !== undefined) {
      const r = await this.#resolveItems(a.items);
      if (!r.ok) return { progress: "Matching your products...", response: r.response };
      items = r.items;
    }
    const res = await updatePendingOrder({
      order_id: id,
      ...(str(a.customer_name) ? { customer_name: str(a.customer_name) } : {}),
      ...(a.delivery_address !== undefined ? { delivery_address: str(a.delivery_address) } : {}),
      ...(str(a.customer_phone) ? { customer_phone: str(a.customer_phone) } : {}),
      ...(items ? { items } : {}),
    });
    if (res.outcome === "noop") {
      return {
        progress: "",
        response: { updated: false, reason: res.reason, hint: "Only not-paid orders can be changed." },
      };
    }
    const card = orderCard(res.order);
    card.undo = { tool: "restore_order", data: { snapshot: res.before } };
    return {
      progress: "Updating the order...",
      response: { updated: true, ...orderForModel(res.order) },
      card,
    };
  }

  async #savePhone(a: Args): Promise<ToolOutcome> {
    const name = str(a.customer_name);
    const phone = str(a.phone);
    if (!name || !phone) return { progress: "", response: { error: "name_and_phone_needed" } };
    const all = await db.customers.toArray();
    const before = findCustomerIn(all, { name });
    const r = await setCustomerPhone(name, phone);
    if (r === "no_customer") {
      return { progress: "", response: { saved: false, hint: "Not a named customer." } };
    }
    const after = findCustomerIn(await db.customers.toArray(), { name });
    return {
      progress: "Saving the number...",
      response: { saved: true, customer: after?.name ?? name },
      card: {
        id: newId(),
        kind: "customer",
        title: after?.name ?? name,
        lines: ["Phone number saved"],
        open: after ? { screen: "customer", customer_ref: after.customer_id } : undefined,
        undo: after
          ? { tool: "restore_phone", data: { customer_id: after.customer_id, phone: before?.phone ?? "" } }
          : undefined,
      },
    };
  }

  // ------------------------------------------------------------ approval tools

  async #propose(name: string, args: Args, cardId?: string): Promise<ToolOutcome> {
    const built = await this.#plan(name, args);
    if ("error" in built) {
      return { progress: "Checking...", response: { proposed: false, ...built } };
    }
    const id = cardId ?? newId();
    this.#proposals.set(id, { id, tool: name, args, plan: built.plan, used: false });
    return {
      progress: "Getting that ready...",
      response: {
        proposed: true,
        status: "awaiting_vendor_approval",
        note: "Nothing has happened yet. Tell the vendor to check the card and tap Approve.",
      },
      card: {
        id,
        kind: "action",
        title: built.title,
        lines: built.lines,
        state: "awaiting",
        proposal: { tool: name, args },
        open: built.open,
      },
    };
  }

  /** Validate an approval request and describe it in plain words. Writes nothing. */
  async #plan(
    tool: string,
    a: Args,
  ): Promise<
    | { plan: Plan; title: string; lines: string[]; open?: ChatCard["open"] }
    | { error: string; hint?: string; options?: string[] }
  > {
    switch (tool) {
      case "confirm_sale": {
        const o = await db.orders.get(str(a.order_ref));
        if (!o) return { error: "order_not_found" };
        if (o.ledger_committed || o.status !== "PENDING_INQUIRY") {
          return { error: "not_pending", hint: `This order is already ${STATUS_WORDS[o.status]?.toLowerCase()}.` };
        }
        if (o.items.length === 0) return { error: "no_items", hint: "This order has no products yet." };
        for (const l of o.items) {
          const s = await db.inventory.get(l.product_id);
          if (!s) return { error: "missing_product", hint: `${l.product_name} is no longer in the Stock Room.` };
        }
        const need = new Map<string, number>();
        for (const l of o.items) need.set(l.product_id, (need.get(l.product_id) ?? 0) + l.quantity);
        for (const [pid, q] of need) {
          const s = await db.inventory.get(pid);
          if (s && s.stock_qty < q) {
            return {
              error: "out_of_stock",
              hint: `Not enough ${s.display_name}: ${s.stock_qty} left, order needs ${q}.`,
            };
          }
        }
        return {
          plan: { kind: "confirm_sale", order_id: o.order_id },
          title: `Mark ${who(o)}'s order as sold?`,
          lines: [
            lineText(o),
            `This takes the items out of stock and books ${formatMoney(orderTotal(o))} as a sale.`,
          ],
          open: { screen: "order", order_ref: o.order_id },
        };
      }
      case "cancel_order": {
        const o = await db.orders.get(str(a.order_ref));
        if (!o) return { error: "order_not_found" };
        if (o.ledger_committed || o.status !== "PENDING_INQUIRY") {
          return { error: "not_pending", hint: "Only not-paid orders can be cancelled." };
        }
        return {
          plan: { kind: "cancel_order", order_id: o.order_id },
          title: `Cancel ${who(o)}'s order?`,
          lines: [lineText(o), "Stock and money stay as they are."],
          open: { screen: "order", order_ref: o.order_id },
        };
      }
      case "delete_orders": {
        const refs = Array.isArray(a.order_refs) ? a.order_refs.map(str).filter(Boolean).slice(0, 25) : [];
        if (refs.length === 0) return { error: "no_orders" };
        const rows = await db.orders.bulkGet(refs);
        for (const r of rows) {
          if (!r) return { error: "order_not_found" };
          if (!DELETABLE.has(r.status) || r.ledger_committed) {
            return {
              error: "cannot_delete",
              hint: "Only not-paid or cancelled orders can be deleted. Sold orders keep your records right.",
            };
          }
        }
        const found = rows as Order[];
        return {
          plan: { kind: "delete_orders", order_ids: found.map((r) => r.order_id) },
          title: `Delete ${found.length} order${found.length === 1 ? "" : "s"}?`,
          lines: [
            found.map((r) => `${who(r)}: ${lineText(r)}`).join(" · "),
            "This removes them for good. It cannot be undone.",
          ],
          open: { screen: "orders" },
        };
      }
      case "process_return": {
        const o = await db.orders.get(str(a.order_ref));
        if (!o) return { error: "order_not_found" };
        if (o.status !== "CONFIRMED_SALE" || !o.ledger_committed) {
          return { error: "not_sold", hint: "Only sold orders can be returned." };
        }
        return {
          plan: { kind: "process_return", order_id: o.order_id },
          title: `Take back ${who(o)}'s sale?`,
          lines: [
            lineText(o),
            `The items go back into stock and ${formatMoney(orderTotal(o))} is taken off your sales.`,
          ],
          open: { screen: "order", order_ref: o.order_id },
        };
      }
      case "log_restock": {
        const qty = numOrNaN(a.quantity);
        const cost = numOrNaN(a.total_cost);
        if (!Number.isInteger(qty) || qty < 1) return { error: "bad_quantity", hint: "Ask how many came in." };
        if (!Number.isFinite(cost) || cost < 0) return { error: "bad_cost", hint: "Ask how much the batch cost." };
        const r = fuzzyFindSkus(str(a.product), await db.inventory.toArray());
        if (r.matches.length === 0) {
          return { error: "product_not_found", hint: "Ask whether to add it as a new product. Do not add silently." };
        }
        if (r.ambiguous) {
          return { error: "ambiguous_product", options: r.matches.map((m) => m.sku.display_name) };
        }
        const s = r.matches[0].sku;
        return {
          plan: { kind: "log_restock", sku_id: s.sku_id, qty, total_cost: cost },
          title: `Add ${qty} ${s.display_name} to stock?`,
          lines: [
            `You will have ${s.stock_qty + qty} in all.`,
            cost > 0 ? `Records ${formatMoney(cost)} spent on goods.` : "No cost recorded.",
          ],
          open: { screen: "stock" },
        };
      }
      case "log_expense": {
        const amount = numOrNaN(a.amount);
        if (!Number.isFinite(amount) || amount <= 0) return { error: "bad_amount" };
        const category = str(a.category) || "Expense";
        return {
          plan: { kind: "log_expense", amount, category, note: str(a.note) },
          title: `Record ${formatMoney(amount)} for ${category}?`,
          lines: ["This comes off your profit for today."],
          open: { screen: "statement" },
        };
      }
      case "create_product": {
        const name = str(a.name);
        const variant = str(a.variant) || "Std";
        const cost = numOrNaN(a.cost_price);
        const price = numOrNaN(a.selling_price);
        const qty = numOrNaN(a.quantity);
        if (!name) return { error: "name_needed" };
        if (![cost, price].every((n) => Number.isFinite(n) && n >= 0)) return { error: "bad_prices" };
        if (!Number.isInteger(qty) || qty < 0) return { error: "bad_quantity" };
        if (await db.inventory.get(skuId(name, variant))) {
          return { error: "already_exists", hint: "You already have this product." };
        }
        return {
          plan: { kind: "create_product", name, variant, cost, price, qty },
          title: `Add ${name} to your Stock Room?`,
          lines: [
            `${qty} in stock · costs ${formatMoney(cost)} · sells ${formatMoney(price)}`,
          ],
          open: { screen: "stock" },
        };
      }
      case "update_product": {
        const r = fuzzyFindSkus(str(a.product), await db.inventory.toArray());
        if (r.matches.length === 0) return { error: "product_not_found" };
        if (r.ambiguous) return { error: "ambiguous_product", options: r.matches.map((m) => m.sku.display_name) };
        const s = r.matches[0].sku;
        const name = str(a.name) || undefined;
        const cost = a.cost_price === undefined ? undefined : numOrNaN(a.cost_price);
        const price = a.selling_price === undefined ? undefined : numOrNaN(a.selling_price);
        if ([cost, price].some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))) {
          return { error: "bad_prices" };
        }
        if (name === undefined && cost === undefined && price === undefined) {
          return { error: "nothing_to_change" };
        }
        const bits: string[] = [];
        if (name) bits.push(`name to ${name}`);
        if (cost !== undefined) bits.push(`cost to ${formatMoney(cost)}`);
        if (price !== undefined) bits.push(`price to ${formatMoney(price)}`);
        return {
          plan: { kind: "update_product", sku_id: s.sku_id, name, cost, price },
          title: `Change ${s.display_name}?`,
          lines: [`Change ${bits.join(", ")}.`, "Your stock count stays the same."],
          open: { screen: "stock" },
        };
      }
      default:
        return { error: "unknown_tool" };
    }
  }

  /** Private: refuses without a matching, unused approval. */
  async #execute(tool: string, plan: Plan, token: ApprovalToken): Promise<ToolOutcome> {
    if (!this.#tokens.delete(token) || token.tool !== tool || token.key !== keyOf(tool, plan)) {
      return { progress: "", response: { ok: false, error: "approval_required" } };
    }
    const done = (message: string, extra: Args = {}): ToolOutcome => ({
      progress: "Done.",
      response: { ok: true, message, ...extra },
    });
    const fail = (message: string): ToolOutcome => ({
      progress: "",
      response: { ok: false, message },
    });
    try {
      switch (plan.kind) {
        case "confirm_sale": {
          const r = await commitConfirmedOrder(plan.order_id);
          if (r.ok && r.outcome === "committed") return done("Marked as sold.");
          if (r.ok) {
            return r.reason === "already_committed"
              ? done("That order was already sold, so nothing changed.")
              : fail("That order cannot be sold now.");
          }
          return fail(
            r.reason === "out_of_stock"
              ? "Not enough in stock, so nothing was changed."
              : r.reason === "missing_sku"
                ? "A product on this order is no longer in the Stock Room."
                : "This order has no products yet.",
          );
        }
        case "cancel_order": {
          const r = await cancelOrArchiveOrder(plan.order_id);
          return r.outcome === "cancelled" ? done("Cancelled.") : fail("That order cannot be cancelled now.");
        }
        case "delete_orders": {
          // The assistant only deletes pending or cancelled orders, re-checked now.
          const rows = await db.orders.bulkGet(plan.order_ids);
          if (rows.some((r) => !r || !DELETABLE.has(r.status) || r.ledger_committed)) {
            return fail("Some of these orders have changed, so nothing was deleted.");
          }
          const r = await deleteOrders(plan.order_ids);
          return r.ok ? done(`Deleted ${r.deleted}.`) : fail("Sold orders cannot be deleted.");
        }
        case "process_return": {
          const r = await processReturn(plan.order_id);
          if (r.ok && r.outcome === "refunded") return done("Return recorded.");
          if (r.ok) {
            return r.reason === "already_refunded"
              ? done("That sale was already returned, so nothing changed.")
              : fail("Only sold orders can be returned.");
          }
          return fail("A product on this order is no longer in the Stock Room.");
        }
        case "log_restock": {
          const r = await commitRestock({ sku_id: plan.sku_id, qty: plan.qty, total_cost: plan.total_cost });
          return done(`Added ${r.qty} to stock.`);
        }
        case "log_expense": {
          await commitExpense({ amount: plan.amount, category: plan.category, note: plan.note });
          return done("Expense recorded.");
        }
        case "create_product": {
          await createSku({
            name: plan.name,
            variant: plan.variant,
            unit_cost_price: plan.cost,
            unit_selling_price: plan.price,
            low_stock_threshold: 4,
            initial_qty: plan.qty,
          });
          return done("Product added.");
        }
        case "update_product": {
          const s = await db.inventory.get(plan.sku_id);
          if (!s) return fail("We could not find that product.");
          await updateSku({
            sku_id: s.sku_id,
            name: plan.name ?? s.display_name,
            unit_cost_price: plan.cost ?? s.unit_cost_price,
            unit_selling_price: plan.price ?? s.unit_selling_price,
            low_stock_threshold: s.low_stock_threshold,
            product_type: s.product_type,
            batch_cost: s.batch_cost,
            batch_qty: s.batch_qty,
          });
          return done("Product updated.");
        }
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : "That did not work.");
    }
  }
}
