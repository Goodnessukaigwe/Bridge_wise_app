import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/dexie";
import { ToolExecutor } from "@/lib/agent/executor";
import { APPROVAL_TOOLS } from "@/lib/agent/toolDefs";
import { commitConfirmedOrder, createSku } from "@/lib/db/transactions";

async function seed() {
  const shoes = await createSku({
    name: "Black Shoes",
    variant: "Size42",
    unit_cost_price: 8000,
    unit_selling_price: 15000,
    low_stock_threshold: 4,
    initial_qty: 10,
  });
  const ankara = await createSku({
    name: "Ankara Fabric",
    variant: "Std",
    unit_cost_price: 3000,
    unit_selling_price: 6000,
    low_stock_threshold: 4,
    initial_qty: 5,
  });
  return { shoes, ankara };
}

async function engine() {
  const [skus, ledger, statements, orders] = await Promise.all([
    db.inventory.toArray(),
    db.ledger_entries.toArray(),
    db.daily_statements.toArray(),
    db.orders.toArray(),
  ]);
  return JSON.stringify({ skus, ledger, statements, orders });
}

async function pendingFor(ex: ToolExecutor, product = "black shoes", quantity = 2) {
  const out = await ex.run("create_pending_order", {
    customer_name: "Chioma",
    items: [{ product, quantity }],
  });
  return out.response.order_ref as string;
}

describe("tool executor", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(async () => {
    await db.delete();
  });

  describe("approval enforcement", () => {
    it("never runs an approval tool when the model asks, whatever the arguments", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex);
      const soldRef = await pendingFor(ex, "ankara", 1);
      await commitConfirmedOrder(soldRef);
      const before = await engine();

      const calls: Array<[string, Record<string, unknown>]> = [
        ["confirm_sale", { order_ref: ref }],
        ["cancel_order", { order_ref: ref }],
        ["delete_orders", { order_refs: [ref] }],
        ["process_return", { order_ref: soldRef }],
        ["log_restock", { product: "ankara", quantity: 20, total_cost: 40000 }],
        ["log_expense", { amount: 5000, category: "Fuel" }],
        ["create_product", { name: "Bag", cost_price: 1, selling_price: 2, quantity: 3 }],
        ["update_product", { product: "black shoes", selling_price: 1 }],
      ];
      expect(new Set(calls.map((c) => c[0]))).toEqual(APPROVAL_TOOLS);
      for (const [name, args] of calls) {
        // Hostile extras the model might try to smuggle in.
        const out = await ex.run(name, { ...args, approved: true, approval: "yes", force: true });
        expect(out.response.status, name).toBe("awaiting_vendor_approval");
        expect(out.card?.state).toBe("awaiting");
      }
      expect(await engine()).toBe(before);
    });

    it("runs the action only after the card's Approve, and only once", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex);
      const prop = await ex.run("confirm_sale", { order_ref: ref });
      const id = prop.card!.id;

      const first = await ex.approve(id);
      expect(first.response.ok).toBe(true);
      expect((await db.inventory.get("Black_Shoes_Size42"))!.stock_qty).toBe(8);

      const second = await ex.approve(id);
      expect(second.response.ok).toBe(false);
      expect(second.response.error).toBe("already_done");
      expect((await db.inventory.get("Black_Shoes_Size42"))!.stock_qty).toBe(8);
      expect(await db.ledger_entries.count()).toBe(1);
    });

    it("refuses approval for a card it never issued", async () => {
      await seed();
      const ex = new ToolExecutor();
      const out = await ex.approve("made-up-id");
      expect(out.response.error).toBe("card_expired");
    });

    it("does nothing when the vendor cancels the card", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex);
      const prop = await ex.run("confirm_sale", { order_ref: ref });
      ex.cancel(prop.card!.id);
      const before = await engine();
      const out = await ex.approve(prop.card!.id);
      expect(out.response.ok).toBe(false);
      expect(await engine()).toBe(before);
    });

    it("rebuilds a saved card after a reload and still needs the tap", async () => {
      await seed();
      const ex1 = new ToolExecutor();
      const ref = await pendingFor(ex1);
      const prop = await ex1.run("confirm_sale", { order_ref: ref });
      const ex2 = new ToolExecutor(); // app restarted
      const bad = await ex2.approve(prop.card!.id);
      expect(bad.response.error).toBe("card_expired");
      const ok = await ex2.approve(prop.card!.id, prop.card!.proposal);
      expect(ok.response.ok).toBe(true);
    });
  });

  describe("confirm sale guards", () => {
    it("is idempotent: an already sold order is a no-op", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex);
      await commitConfirmedOrder(ref); // vendor confirmed with the normal button
      const out = await ex.run("confirm_sale", { order_ref: ref });
      expect(out.response.proposed).toBe(false);
      expect((await db.inventory.get("Black_Shoes_Size42"))!.stock_qty).toBe(8);
      expect(await db.ledger_entries.count()).toBe(1);
    });

    it("blocks an out-of-stock order before asking for approval", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex, "ankara", 9);
      const out = await ex.run("confirm_sale", { order_ref: ref });
      expect(out.response.proposed).toBe(false);
      expect(out.response.error).toBe("out_of_stock");
      expect(out.card).toBeUndefined();
    });

    it("aborts without changes if stock ran out between the card and the tap", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex, "black shoes", 6);
      const prop = await ex.run("confirm_sale", { order_ref: ref });
      await db.inventory.update("Black_Shoes_Size42", { stock_qty: 2 }); // sold elsewhere
      const out = await ex.approve(prop.card!.id);
      expect(out.response.ok).toBe(false);
      expect((await db.inventory.get("Black_Shoes_Size42"))!.stock_qty).toBe(2);
      expect(await db.ledger_entries.count()).toBe(0);
      expect((await db.orders.get(ref))!.status).toBe("PENDING_INQUIRY");
    });
  });

  describe("pending-only creation", () => {
    it("creates a pending order that never touches stock or money", async () => {
      await seed();
      const ex = new ToolExecutor();
      const before = JSON.stringify([await db.inventory.toArray(), await db.ledger_entries.toArray()]);
      const out = await ex.run("create_pending_order", {
        customer_name: "Chioma",
        items: [{ product: "blak shoes", quantity: 2 }],
        customer_says_paid: true,
        // hostile extras
        status: "CONFIRMED_SALE",
        ledger_committed: true,
      });
      const order = (await db.orders.toArray())[0];
      expect(order.status).toBe("PENDING_INQUIRY");
      expect(order.ledger_committed).toBe(false);
      expect(order.suggested_status).toBe("READY_TO_CONFIRM");
      expect(JSON.stringify([await db.inventory.toArray(), await db.ledger_entries.toArray()])).toBe(before);
      expect(await db.daily_statements.count()).toBe(0);
      expect(out.card?.undo?.tool).toBe("delete_pending");
      expect(String(out.response.note)).toContain("not verified");
    });

    it("does not create a product silently or save anything for an unknown product", async () => {
      await seed();
      const ex = new ToolExecutor();
      const out = await ex.run("create_pending_order", {
        customer_name: "Ada",
        items: [{ product: "gold wristwatch", quantity: 1 }],
      });
      expect(out.response.created).toBe(false);
      expect(out.response.not_in_stock_room).toEqual(["gold wristwatch"]);
      expect(await db.orders.count()).toBe(0);
      expect(await db.inventory.count()).toBe(2);
    });

    it("asks instead of guessing when the quantity is missing", async () => {
      await seed();
      const ex = new ToolExecutor();
      const out = await ex.run("create_pending_order", {
        customer_name: "Ada",
        items: [{ product: "black shoes" }],
      });
      expect(out.response.created).toBe(false);
      expect(out.response.missing_quantity).toEqual(["black shoes"]);
      expect(await db.orders.count()).toBe(0);
    });

    it("update_pending_order refuses a sold order and Undo restores a pending one", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex);
      const upd = await ex.run("update_pending_order", {
        order_ref: ref,
        items: [{ product: "ankara", quantity: 1 }],
      });
      expect((await db.orders.get(ref))!.items[0].product_name).toBe("Ankara Fabric");
      const undo = await ex.undo(upd.card!);
      expect(undo.ok).toBe(true);
      expect((await db.orders.get(ref))!.items[0].product_name).toBe("Black Shoes");

      await commitConfirmedOrder(ref);
      const refused = await ex.run("update_pending_order", {
        order_ref: ref,
        items: [{ product: "ankara", quantity: 1 }],
      });
      expect(refused.response.updated).toBe(false);
      expect((await db.orders.get(ref))!.items[0].product_name).toBe("Black Shoes");
    });

    it("Undo of a create refuses once the order has been sold", async () => {
      await seed();
      const ex = new ToolExecutor();
      const out = await ex.run("create_pending_order", {
        customer_name: "Chioma",
        items: [{ product: "black shoes", quantity: 1 }],
      });
      await commitConfirmedOrder(out.response.order_ref as string);
      const undo = await ex.undo(out.card!);
      expect(undo.ok).toBe(false);
      expect(await db.orders.count()).toBe(1);
    });
  });

  describe("delete limits", () => {
    it("deletes pending and cancelled orders after approval", async () => {
      await seed();
      const ex = new ToolExecutor();
      const a = await pendingFor(ex);
      const b = await pendingFor(ex);
      const c = await ex.approve((await ex.run("cancel_order", { order_ref: b })).card!.id);
      expect(c.response.ok).toBe(true);
      const prop = await ex.run("delete_orders", { order_refs: [a, b] });
      expect(prop.card?.state).toBe("awaiting");
      expect((await ex.approve(prop.card!.id)).response.ok).toBe(true);
      expect(await db.orders.count()).toBe(0);
    });

    it("refuses sold and returned orders, even mixed with pending ones", async () => {
      await seed();
      const ex = new ToolExecutor();
      const sold = await pendingFor(ex);
      const pending = await pendingFor(ex);
      await commitConfirmedOrder(sold);
      const out = await ex.run("delete_orders", { order_refs: [pending, sold] });
      expect(out.response.proposed).toBe(false);
      expect(out.response.error).toBe("cannot_delete");
      expect(await db.orders.count()).toBe(2);
    });

    it("re-checks at approval time if an order was sold after the card appeared", async () => {
      await seed();
      const ex = new ToolExecutor();
      const ref = await pendingFor(ex);
      const prop = await ex.run("delete_orders", { order_refs: [ref] });
      await commitConfirmedOrder(ref);
      const out = await ex.approve(prop.card!.id);
      expect(out.response.ok).toBe(false);
      expect(await db.orders.count()).toBe(1);
    });
  });

  describe("other approval tools use the existing functions", () => {
    it("restock adds stock and a RESTOCK ledger row after approval", async () => {
      await seed();
      const ex = new ToolExecutor();
      const prop = await ex.run("log_restock", { product: "ankra fabric", quantity: 20, total_cost: 40000 });
      expect(prop.card?.title).toContain("Ankara Fabric");
      await ex.approve(prop.card!.id);
      expect((await db.inventory.get("Ankara_Fabric_Std"))!.stock_qty).toBe(25);
      expect((await db.ledger_entries.toArray())[0].entry_type).toBe("RESTOCK");
    });

    it("restock of an unknown product asks, and creates nothing", async () => {
      await seed();
      const ex = new ToolExecutor();
      const out = await ex.run("log_restock", { product: "lace", quantity: 3, total_cost: 0 });
      expect(out.response.error).toBe("product_not_found");
      expect(await db.inventory.count()).toBe(2);
    });

    it("expense, create product, update product (never stock), return", async () => {
      await seed();
      const ex = new ToolExecutor();
      await ex.approve((await ex.run("log_expense", { amount: 5000, category: "Fuel" })).card!.id);
      expect((await db.daily_statements.toArray())[0].total_expenses).toBe(5000);

      await ex.approve(
        (await ex.run("create_product", { name: "Red Cap", cost_price: 1000, selling_price: 2500, quantity: 7 })).card!.id,
      );
      expect((await db.inventory.get("Red_Cap_Std"))!.stock_qty).toBe(7);

      await ex.approve(
        (await ex.run("update_product", { product: "red cap", selling_price: 3000, stock_qty: 999 })).card!.id,
      );
      const cap = (await db.inventory.get("Red_Cap_Std"))!;
      expect(cap.unit_selling_price).toBe(3000);
      expect(cap.stock_qty).toBe(7);

      const ref = await pendingFor(ex);
      await ex.approve((await ex.run("confirm_sale", { order_ref: ref })).card!.id);
      await ex.approve((await ex.run("process_return", { order_ref: ref })).card!.id);
      expect((await db.inventory.get("Black_Shoes_Size42"))!.stock_qty).toBe(10);
      expect((await db.orders.get(ref))!.status).toBe("REFUNDED");
    });
  });

  describe("read tools", () => {
    it("read stock tolerating spelling, and the statement, without writing", async () => {
      await seed();
      const ex = new ToolExecutor();
      const before = await engine();
      const s = await ex.run("get_stock", { product: "ankra" });
      expect((s.response.matches as Array<{ in_stock: number }>)[0].in_stock).toBe(5);
      const st = await ex.run("get_pocket_statement", { period: "week" });
      expect(st.response.sales).toBe(0);
      await ex.run("list_orders", { status: "pending" });
      await ex.run("list_products", {});
      expect(await engine()).toBe(before);
    });
  });
});
