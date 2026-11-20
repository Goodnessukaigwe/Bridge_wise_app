import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";

describe("Dexie v3 migration", () => {
  it("keeps every existing row when the chat store is added", async () => {
    // A phone that still has the version 2 database.
    const old = new Dexie("BridgeWise");
    old.version(1).stores({
      orders: "&order_id, status, date_key, ledger_committed",
      inventory: "&sku_id, status_color",
      ledger_entries: "&txn_id, date_key, entry_type, ref_order_id",
      daily_statements: "&date_key",
      customers: "&customer_id, name",
    });
    old.version(2).stores({ sync_queue: "&id, kind, created_at" });
    await old.open();
    await old.table("inventory").add({ sku_id: "A_Std", display_name: "A", stock_qty: 7 });
    await old.table("customers").add({ customer_id: "CUST_Ada", name: "Ada" });
    await old.table("orders").add({ order_id: "Ada_2026-11-01_Ord001", status: "PENDING_INQUIRY", date_key: "2026-11-01", ledger_committed: false });
    old.close();

    const { db } = await import("@/lib/db/dexie");
    await db.open();
    expect(await db.inventory.count()).toBe(1);
    expect((await db.inventory.get("A_Std"))!.stock_qty).toBe(7);
    expect(await db.customers.count()).toBe(1);
    expect(await db.orders.count()).toBe(1);
    expect(await db.chat_messages.count()).toBe(0);
    await db.chat_messages.put({ id: "1", role: "user", text: "hi", at: 1 });
    expect(await db.chat_messages.count()).toBe(1);
    db.close();
  });
});
