import Dexie, { type EntityTable } from "dexie";
import type {
  Customer,
  DailyStatement,
  LedgerEntry,
  LedgerEntryType,
  Order,
  Sku,
  SyncQueueRow,
} from "@/types/bridgewise";

export const LOW_STOCK_THRESHOLD = 4;

export class BridgeWiseDB extends Dexie {
  orders!: EntityTable<Order, "order_id">;
  inventory!: EntityTable<Sku, "sku_id">;
  ledger_entries!: EntityTable<LedgerEntry, "txn_id">;
  daily_statements!: EntityTable<DailyStatement, "date_key">;
  customers!: EntityTable<Customer, "customer_id">;
  sync_queue!: EntityTable<SyncQueueRow, "id">;

  constructor() {
    super("BridgeWise");
    this.version(1).stores({
      orders: "&order_id, status, date_key, ledger_committed",
      inventory: "&sku_id, status_color",
      ledger_entries: "&txn_id, date_key, entry_type, ref_order_id",
      daily_statements: "&date_key",
      customers: "&customer_id, name",
    });
    this.version(2).stores({
      sync_queue: "&id, kind, created_at",
    });
  }
}

export const db = new BridgeWiseDB();

/** Spaces become `_`; other non-token characters are dropped. */
export function toIdToken(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_+-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function padSeq(seq: number): string {
  return String(seq).padStart(3, "0");
}

/** `Chioma_2026-11-12_Ord004`. Parser `ORD-…` ids stay payload-only. */
export function nextOrderId(
  customerName: string,
  dateKey: string,
  seq: number,
): string {
  return `${toIdToken(customerName)}_${dateKey}_Ord${padSeq(seq)}`;
}

/** `Black_Shoes_Size42` */
export function skuId(productSlug: string, variant: string): string {
  return `${toIdToken(productSlug)}_${toIdToken(variant)}`;
}

/** Last `_` segment of `[Product_Slug]_[Variant]`. */
export function variantFromSkuId(id: string): string {
  const i = id.lastIndexOf("_");
  return i === -1 ? id : id.slice(i + 1);
}

/** `TXN_2026-11-12_SALE_009` */
export function nextTxnId(
  dateKey: string,
  type: LedgerEntryType,
  seq: number,
): string {
  return `TXN_${dateKey}_${type}_${padSeq(seq)}`;
}

/** `Daily_Summary_YYYY-MM-DD` */
export function statementId(dateKey: string): string {
  return `Daily_Summary_${dateKey}`;
}

/** Local calendar `YYYY-MM-DD` (device timezone). */
export function todayDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `CUST_Chioma_Nwosu` */
export function customerId(phoneOrName: string): string {
  return `CUST_${toIdToken(phoneOrName)}`;
}

const DEV_SEED_SKUS: Sku[] = [
  {
    sku_id: skuId("Black Shoes", "Size42"),
    display_name: "Black Shoes Size 42",
    stock_qty: 18,
    low_stock_threshold: LOW_STOCK_THRESHOLD,
    unit_cost_price: 8000,
    unit_selling_price: 15000,
    status_color: "GREEN",
  },
  {
    sku_id: skuId("Blue Handbag", "Std"),
    display_name: "Blue Handbag",
    stock_qty: 3,
    low_stock_threshold: LOW_STOCK_THRESHOLD,
    unit_cost_price: 8000,
    unit_selling_price: 15000,
    status_color: "YELLOW",
  },
  {
    sku_id: skuId("Red Velvet Cake", "8in"),
    display_name: "Red Velvet Cake 8in",
    stock_qty: 0,
    low_stock_threshold: LOW_STOCK_THRESHOLD,
    unit_cost_price: 5000,
    unit_selling_price: 10000,
    status_color: "RED",
  },
];

/** Dev-only. Writes inventory SKUs; never orders or ledger. */
export async function ensureDevSeed(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.VITEST) return;
  if (typeof indexedDB === "undefined") return;

  const count = await db.inventory.count();
  if (count > 0) return;

  await db.inventory.bulkPut(DEV_SEED_SKUS);
}

if (typeof indexedDB !== "undefined") {
  void ensureDevSeed();
}
