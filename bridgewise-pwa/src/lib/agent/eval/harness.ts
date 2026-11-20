import { db } from "@/lib/db/dexie";
import { ToolExecutor } from "@/lib/agent/executor";
import { runTurn, type ModelTransport, type TurnResult } from "@/lib/agent/loop";
import { buildSession } from "@/lib/agent/session";
import { createPendingOrder, createSku } from "@/lib/db/transactions";
import type { ChatCard } from "@/lib/agent/types";
import type { LedgerEntry, Order, Sku } from "@/types/bridgewise";

export async function seedShop() {
  const add = (name: string, variant: string, cost: number, price: number, qty: number) =>
    createSku({
      name, variant, unit_cost_price: cost, unit_selling_price: price,
      low_stock_threshold: 4, initial_qty: qty,
    });
  await add("Ankara Fabric", "Std", 3000, 6000, 30);
  await add("Black Shoes", "Size42", 8000, 15000, 10);
  await add("Blue Handbag", "Std", 8000, 15000, 3);
  await add("Red Velvet Cake", "8in", 5000, 10000, 0);
  await add("Gold Chain", "Std", 6000, 12000, 8);
}

export type Outcome = {
  result: TurnResult;
  orders: Order[];
  skus: Sku[];
  ledger: LedgerEntry[];
  cards: ChatCard[];
  executor: ToolExecutor;
};

export async function playTurn(
  userText: string,
  transport: ModelTransport,
  executor = new ToolExecutor(),
  extraParts: Array<Record<string, unknown>> = [],
): Promise<Outcome> {
  const session = await buildSession("Test Shop");
  const result = await runTurn({
    session,
    history: [],
    user: [{ text: userText }, ...(extraParts as never[])],
    executor,
    transport,
  });
  return {
    result,
    orders: await db.orders.toArray(),
    skus: await db.inventory.toArray(),
    ledger: await db.ledger_entries.toArray(),
    cards: result.cards,
    executor,
  };
}

export async function seedPending(customer: string, product: string, qty: number) {
  const skus = await db.inventory.toArray();
  const sku = skus.find((s) => s.display_name.toLowerCase().includes(product.toLowerCase()))!;
  return createPendingOrder({
    customer_name: customer,
    items: [{ product_id: sku.sku_id, quantity: qty }],
  });
}
