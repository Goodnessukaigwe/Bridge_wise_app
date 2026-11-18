/**
 * BridgeWise domain contract.
 *
 * Parse / paste / share never commit the ledger. Only Confirm Sale sets
 * `ledger_committed` and mutates stock.
 *
 * Deterministic IndexedDB keys (human-readable) — generators in `src/lib/db/dexie.ts`:
 * - orders:            `[Customer]_[YYYY-MM-DD]_[Seq]`  e.g. Chioma_2026-11-12_Ord004
 *                      Parser sample ids like `ORD-20261112-004` are payload-only, not PKs.
 * - inventory:         `[Product_Slug]_[Variant]`       e.g. Black_Shoes_Size42
 * - ledger_entries:    `TXN_[YYYY-MM-DD]_[Type]_[Seq]`
 * - daily_statements:  `Daily_Summary_[YYYY-MM-DD]`
 * - customers:         `CUST_[Phone_or_NameHash]`       e.g. CUST_Chioma_Nwosu
 */

/** Persisted order states. READY_TO_CONFIRM is never stored. */
export type OrderStatus =
  | "PENDING_INQUIRY"
  | "CONFIRMED_SALE"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED";

/** AI / UI hint when payment or commitment language is detected. */
export type SuggestedConfirmStatus = "READY_TO_CONFIRM";

export type CaptureMethod =
  | "whatsapp_share_sheet"
  | "clipboard"
  | "manual";

export type IntentClassification =
  | "INQUIRY"
  | "HIGH_PURCHASE_INTENT";

export type StockColor = "GREEN" | "YELLOW" | "RED";

export type LedgerEntryType = "SALE" | "EXPENSE" | "RESTOCK" | "RETURN";

export interface OrderLine {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost_price: number;
  unit_selling_price: number;
}

export type ProductType = "reseller" | "maker";

export interface Sku {
  sku_id: string;
  display_name: string;
  stock_qty: number;
  low_stock_threshold: number;
  unit_cost_price: number;
  unit_selling_price: number;
  status_color: StockColor;
  /** Last restock batch size. Drives the 20% low-stock floor when set. */
  last_restock_qty?: number;
  product_type?: ProductType;
  batch_cost?: number | null;
  batch_qty?: number | null;
}

export interface LedgerEntry {
  txn_id: string;
  date_key: string;
  ref_order_id?: string;
  /** SKU restocked; never set on SALE. */
  ref_sku_id?: string;
  entry_type: LedgerEntryType;
  gross_amount: number;
  capital_portion: number;
  net_profit_portion: number;
  category?: string;
  note?: string;
  /** ms epoch; stamped on new entries, absent on old ones. */
  created_at?: number;
}

export interface DailyStatement {
  date_key: string;
  total_sales: number;
  total_expenses: number;
  protected_capital: number;
  net_profit: number;
}

export interface Customer {
  customer_id: string;
  name: string;
  saved_addresses: string[];
  preferences: string[];
}

export interface Order {
  order_id: string;
  customer_name: string;
  items: OrderLine[];
  delivery_address: string;
  status: OrderStatus;
  ledger_committed: boolean;
  capture_method: CaptureMethod;
  date_key: string;
  seq: number;
  /** ms epoch stamped on pending create. Missing rows use date_key local midnight. */
  created_at?: number;
  /** Original WhatsApp / clipboard body. Empty `items` means still unparsed. */
  raw_text?: string;
  intent_classification?: IntentClassification;
  payment_signal_detected?: boolean;
  suggested_status?: SuggestedConfirmStatus;
}

/** Later Supabase jobs can reuse `kind`; Phase 14 only enqueues `parse`. */
export type SyncQueueKind = "parse";

export interface SyncQueueRow {
  id: string;
  kind: SyncQueueKind;
  order_id: string;
  raw_text: string;
  capture_method: CaptureMethod;
  created_at: number;
  attempts: number;
}

export type ParseKind = "order" | "expense" | "restock";

export interface ParseExpenseLine {
  amount: number;
  category: string;
}

/**
 * Structured parse payload. Status and ledger flags are literals so this
 * object cannot be typed as a confirmed / committed sale.
 * `kind` is extraction only — expense/restock never become pending SALE rows.
 */
export interface ParseResult {
  kind: ParseKind;
  order_id?: string;
  capture_method: CaptureMethod;
  customer_name: string;
  delivery_address: string;
  items: OrderLine[];
  intent_classification: IntentClassification;
  payment_signal_detected: boolean;
  suggested_status?: SuggestedConfirmStatus;
  status: "PENDING_INQUIRY";
  ledger_committed: false;
  amount?: number;
  category?: string;
  note?: string;
  qty?: number;
  total_cost?: number;
  sku_hint?: string;
  expenses?: ParseExpenseLine[];
}

export type ConfirmableOrder = Order & {
  status: "PENDING_INQUIRY";
  ledger_committed: false;
  suggested_status?: SuggestedConfirmStatus;
};
