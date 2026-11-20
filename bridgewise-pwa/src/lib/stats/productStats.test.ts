import { describe, expect, it } from "vitest";
import type { LedgerEntry, Order } from "@/types/bridgewise";
import {
  buildSaleLines,
  compareProduct,
  shiftDateKey,
  summarise,
} from "./productStats";

function order(id: string, status: Order["status"], qty: number): Order {
  return {
    order_id: id,
    customer_name: "Chioma",
    items: [
      {
        product_id: "Bag_Std",
        product_name: "Bag",
        quantity: qty,
        unit_cost_price: 100,
        unit_selling_price: 250,
      },
    ],
    delivery_address: "",
    status,
    ledger_committed: status === "CONFIRMED_SALE",
    capture_method: "manual",
    date_key: "2026-11-20",
    seq: 1,
  };
}

function sale(id: string, orderId: string, dateKey: string): LedgerEntry {
  return {
    txn_id: id,
    date_key: dateKey,
    ref_order_id: orderId,
    entry_type: "SALE",
    gross_amount: 0,
    capital_portion: 0,
    net_profit_portion: 0,
  };
}

describe("productStats", () => {
  it("shifts date keys across month ends", () => {
    expect(shiftDateKey("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("ignores returned orders and sums revenue and profit", () => {
    const lines = buildSaleLines(
      [sale("a", "o1", "2026-11-20"), sale("b", "o2", "2026-11-20")],
      [order("o1", "CONFIRMED_SALE", 2), order("o2", "REFUNDED", 5)],
    );
    const s = summarise(lines, "today", "2026-11-20");
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].units).toBe(2);
    expect(s.rows[0].revenue).toBe(500);
    expect(s.rows[0].profit).toBe(300);
  });

  it("compares with the previous period in plain words", () => {
    const lines = buildSaleLines(
      [sale("a", "o1", "2026-11-20"), sale("b", "o2", "2026-11-19")],
      [order("o1", "CONFIRMED_SALE", 3), order("o2", "CONFIRMED_SALE", 1)],
    );
    const s = summarise(lines, "today", "2026-11-20");
    const r = s.rows[0];
    expect(compareProduct(r.units, r.prevUnits, "today").tone).toBe("up");
    expect(compareProduct(1, 3, "week").text).toBe("Slower than last week");
  });
});
