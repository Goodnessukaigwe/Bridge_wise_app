import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/dexie";
import {
  PENDING_TTL_MS,
  commitConfirmedOrder,
  createPendingOrder,
  createSku,
  expireStalePendingOrders,
  processReturn,
} from "@/lib/db/transactions";

const DATE_KEY = "2026-11-16";

async function seedInStockSku() {
  return createSku({
    name: "Black Shoes",
    variant: "Size42",
    unit_cost_price: 8000,
    unit_selling_price: 15000,
    low_stock_threshold: 4,
    initial_qty: 10,
  });
}

async function snapshotEngine() {
  const [skus, ledger, statements, orders] = await Promise.all([
    db.inventory.toArray(),
    db.ledger_entries.toArray(),
    db.daily_statements.toArray(),
    db.orders.toArray(),
  ]);
  return { skus, ledger, statements, orders };
}

describe("atomic engine", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("createPendingOrder does not change SKU qty or daily_statements", async () => {
    const sku = await seedInStockSku();
    const before = await snapshotEngine();

    const order = await createPendingOrder({
      customer_name: "Chioma",
      items: [{ product_id: sku.sku_id, quantity: 2 }],
      delivery_address: "Lekki Phase 1",
      capture_method: "clipboard",
      date_key: DATE_KEY,
    });

    expect(order.status).toBe("PENDING_INQUIRY");
    expect(order.ledger_committed).toBe(false);

    const after = await snapshotEngine();
    expect(after.skus.map((row) => [row.sku_id, row.stock_qty])).toEqual(
      before.skus.map((row) => [row.sku_id, row.stock_qty]),
    );
    expect(after.ledger).toEqual([]);
    expect(after.statements).toEqual(before.statements);
    expect(after.statements).toEqual([]);
  });

  it("commitConfirmedOrder deducts qty, writes SALE, and updates pocket", async () => {
    const sku = await seedInStockSku();
    const order = await createPendingOrder({
      customer_name: "Chioma",
      items: [{ product_id: sku.sku_id, quantity: 2 }],
      date_key: DATE_KEY,
    });

    const result = await commitConfirmedOrder(order.order_id);
    expect(result).toEqual({
      ok: true,
      outcome: "committed",
      order_id: order.order_id,
    });

    const updatedSku = await db.inventory.get(sku.sku_id);
    expect(updatedSku?.stock_qty).toBe(8);

    const committed = await db.orders.get(order.order_id);
    expect(committed?.status).toBe("CONFIRMED_SALE");
    expect(committed?.ledger_committed).toBe(true);

    const sales = await db.ledger_entries
      .where("entry_type")
      .equals("SALE")
      .toArray();
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      date_key: DATE_KEY,
      ref_order_id: order.order_id,
      entry_type: "SALE",
      gross_amount: 30000,
      capital_portion: 16000,
      net_profit_portion: 14000,
    });

    const pocket = await db.daily_statements.get(DATE_KEY);
    expect(pocket).toEqual({
      date_key: DATE_KEY,
      total_sales: 30000,
      total_expenses: 0,
      protected_capital: 16000,
      net_profit: 14000,
    });
  });

  it("second confirm is a no-op (qty and ledger unchanged)", async () => {
    const sku = await seedInStockSku();
    const order = await createPendingOrder({
      customer_name: "Chioma",
      items: [{ product_id: sku.sku_id, quantity: 2 }],
      date_key: DATE_KEY,
    });

    await commitConfirmedOrder(order.order_id);
    const afterFirst = await snapshotEngine();

    const second = await commitConfirmedOrder(order.order_id);
    expect(second).toEqual({
      ok: true,
      outcome: "noop",
      reason: "already_committed",
    });

    const afterSecond = await snapshotEngine();
    expect(afterSecond.skus.map((row) => [row.sku_id, row.stock_qty])).toEqual(
      afterFirst.skus.map((row) => [row.sku_id, row.stock_qty]),
    );
    expect(afterSecond.ledger).toEqual(afterFirst.ledger);
    expect(afterSecond.statements).toEqual(afterFirst.statements);
  });

  it("RED / would-go-negative aborts the whole txn with no writes", async () => {
    const inStock = await seedInStockSku();
    const red = await createSku({
      name: "Red Velvet Cake",
      variant: "8in",
      unit_cost_price: 5000,
      unit_selling_price: 10000,
      low_stock_threshold: 4,
      initial_qty: 0,
    });
    const tight = await createSku({
      name: "Blue Handbag",
      variant: "Std",
      unit_cost_price: 8000,
      unit_selling_price: 15000,
      low_stock_threshold: 4,
      initial_qty: 1,
    });

    const redOrder = await createPendingOrder({
      customer_name: "Amaka",
      items: [
        { product_id: inStock.sku_id, quantity: 1 },
        { product_id: red.sku_id, quantity: 1 },
      ],
      date_key: DATE_KEY,
    });
    const beforeRed = await snapshotEngine();

    const redResult = await commitConfirmedOrder(redOrder.order_id);
    expect(redResult).toEqual({
      ok: false,
      outcome: "aborted",
      reason: "out_of_stock",
      sku_id: red.sku_id,
    });

    const afterRed = await snapshotEngine();
    expect(afterRed.skus.map((row) => [row.sku_id, row.stock_qty])).toEqual(
      beforeRed.skus.map((row) => [row.sku_id, row.stock_qty]),
    );
    expect(afterRed.ledger).toEqual([]);
    expect(afterRed.statements).toEqual([]);
    const stillPending = await db.orders.get(redOrder.order_id);
    expect(stillPending?.status).toBe("PENDING_INQUIRY");
    expect(stillPending?.ledger_committed).toBe(false);

    const negativeOrder = await createPendingOrder({
      customer_name: "Tunde",
      items: [{ product_id: tight.sku_id, quantity: 2 }],
      date_key: DATE_KEY,
    });
    const beforeNegative = await snapshotEngine();

    const negativeResult = await commitConfirmedOrder(negativeOrder.order_id);
    expect(negativeResult).toEqual({
      ok: false,
      outcome: "aborted",
      reason: "out_of_stock",
      sku_id: tight.sku_id,
    });

    const afterNegative = await snapshotEngine();
    expect(
      afterNegative.skus.map((row) => [row.sku_id, row.stock_qty]),
    ).toEqual(beforeNegative.skus.map((row) => [row.sku_id, row.stock_qty]));
    expect(afterNegative.ledger).toEqual([]);
    expect(afterNegative.statements).toEqual([]);
  });

  it("processReturn restores qty and pocket; second return is a no-op", async () => {
    const sku = await seedInStockSku();
    const order = await createPendingOrder({
      customer_name: "Chioma",
      items: [{ product_id: sku.sku_id, quantity: 2 }],
      date_key: DATE_KEY,
    });
    await commitConfirmedOrder(order.order_id);

    const refunded = await processReturn(order.order_id);
    expect(refunded).toEqual({
      ok: true,
      outcome: "refunded",
      order_id: order.order_id,
    });

    const restored = await db.inventory.get(sku.sku_id);
    expect(restored?.stock_qty).toBe(10);

    const returned = await db.orders.get(order.order_id);
    expect(returned?.status).toBe("REFUNDED");
    expect(returned?.ledger_committed).toBe(true);

    const returns = await db.ledger_entries
      .where("entry_type")
      .equals("RETURN")
      .toArray();
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({
      date_key: DATE_KEY,
      ref_order_id: order.order_id,
      entry_type: "RETURN",
      gross_amount: 30000,
      capital_portion: 16000,
    });

    const pocket = await db.daily_statements.get(DATE_KEY);
    expect(pocket).toEqual({
      date_key: DATE_KEY,
      total_sales: 0,
      total_expenses: 0,
      protected_capital: 0,
      net_profit: 0,
    });

    const afterFirst = await snapshotEngine();
    const second = await processReturn(order.order_id);
    expect(second).toEqual({
      ok: true,
      outcome: "noop",
      reason: "already_refunded",
    });

    const afterSecond = await snapshotEngine();
    expect(afterSecond.skus.map((row) => [row.sku_id, row.stock_qty])).toEqual(
      afterFirst.skus.map((row) => [row.sku_id, row.stock_qty]),
    );
    expect(afterSecond.ledger).toEqual(afterFirst.ledger);
    expect(afterSecond.statements).toEqual(afterFirst.statements);
  });

  it("expireStalePendingOrders marks 72h-old pending EXPIRED with no ledger", async () => {
    const sku = await seedInStockSku();
    const now = Date.now();
    const order = await createPendingOrder({
      customer_name: "Ghost Lead",
      items: [{ product_id: sku.sku_id, quantity: 1 }],
      date_key: DATE_KEY,
      created_at: now - PENDING_TTL_MS - 1,
    });

    const expiredCount = await expireStalePendingOrders(now);
    expect(expiredCount).toBe(1);

    const expired = await db.orders.get(order.order_id);
    expect(expired?.status).toBe("EXPIRED");
    expect(expired?.ledger_committed).toBe(false);

    const skuAfter = await db.inventory.get(sku.sku_id);
    expect(skuAfter?.stock_qty).toBe(10);
    expect(await db.ledger_entries.count()).toBe(0);
    expect(await db.daily_statements.count()).toBe(0);
  });
});
