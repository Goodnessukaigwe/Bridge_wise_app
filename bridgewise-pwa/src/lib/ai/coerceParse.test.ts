import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coerceParseResult } from "@/lib/ai/coerceParse";

const coerceSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "coerceParse.ts"),
  "utf8",
);

describe("coerceParseResult", () => {
  it("forces PENDING_INQUIRY and ledger_committed false when the model claims a confirmed sale", () => {
    const result = coerceParseResult(
      {
        kind: "order",
        status: "CONFIRMED_SALE",
        ledger_committed: true,
        customer_name: "Chioma",
        delivery_address: "Lekki Phase 1",
        items: [
          {
            product_id: "Black_Shoes_Size42",
            product_name: "Black Shoes",
            quantity: 2,
            unit_cost_price: 8000,
            unit_selling_price: 15000,
          },
        ],
        intent_classification: "HIGH_PURCHASE_INTENT",
        payment_signal_detected: true,
        suggested_status: "READY_TO_CONFIRM",
      },
      "clipboard",
    );

    expect(result.status).toBe("PENDING_INQUIRY");
    expect(result.ledger_committed).toBe(false);
    // Literal `false` — a test that expected coerce to commit inventory must fail.
    const ledgerCommitted: false = result.ledger_committed;
    expect(ledgerCommitted).toBe(false);
    expect(result.customer_name).toBe("Chioma");
    expect(result.items).toHaveLength(1);
    expect(result.capture_method).toBe("clipboard");
  });

  it("is pure: no Dexie, no inventory, so it cannot commit stock", () => {
    expect(coerceSource).not.toMatch(/from ["']dexie["']/);
    expect(coerceSource).not.toMatch(/from ["']@\/lib\/db/);
    expect(coerceSource).not.toMatch(/commitConfirmedOrder/);
    expect(coerceSource).not.toMatch(/indexedDB/);

    const result = coerceParseResult(
      { ledger_committed: true, status: "CONFIRMED_SALE" },
      "manual",
    );
    expect(result.status).toBe("PENDING_INQUIRY");
    expect(result.ledger_committed).toBe(false);
  });
});
