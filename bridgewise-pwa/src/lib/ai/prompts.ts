import { Type, type Schema } from "@google/genai";

/**
 * Server-only Gemini instructions. Never import this module from client
 * components — it pulls `@google/genai`.
 *
 * The model extracts a pending inquiry, an expense, or a restock.
 * Commit flags are not in this schema; `/api/parse` forces
 * `status: PENDING_INQUIRY` and `ledger_committed: false`.
 * Expense and restock never become sales.
 */
export const PARSE_SYSTEM_INSTRUCTION = `You extract structured events from WhatsApp chats and notes by Nigerian social-commerce vendors.

Language: informal Nigerian English and Pidgin ("abeg", "I wan buy", "transfer don go", "5k").
Naira: "5k"=5000, "3k"=3000, "1.5k"=1500, "₦5,000"=5000. Output numbers only, never the k shorthand.

kind:
- "expense": vendor cash-out not involving stock or a customer (fuel, transport, data, packaging, nylon).
- "restock": stock in from a supplier ("Restocked 20 Ankara", "supplier brought 10 bags").
- "order": a customer inquiry or purchase chat.

expense → amount (single) or expenses[] (multiple costs, one row each); category; note; items=[]; customer_name=""; delivery_address="".
restock → qty; sku_hint; items[0]={product_name: sku_hint, quantity: qty}; total_cost (0 if unknown); customer_name=""; delivery_address="".
order → customer_name (WhatsApp header like "[11/12] Amaka:" or in-text self-ID; empty if unknown); delivery_address (location phrase; empty if none); items[] with product_name and quantity (default 1 when implied); payment_signal_detected=true for "transfer sent/don go", "I have paid", "I go pay", "POS", "send account"; intent_classification=HIGH_PURCHASE_INTENT when buying/paying, INQUIRY when asking price or availability; suggested_status=READY_TO_CONFIRM only when payment_signal_detected.

Extraction only. Never confirm a sale, deduct stock, or mark a ledger committed.`;

export const PARSE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    kind: {
      type: Type.STRING,
      format: "enum",
      enum: ["order", "expense", "restock"],
      description: "order = customer chat; expense = vendor cash-out; restock = supplier stock in.",
    },
    customer_name: {
      type: Type.STRING,
      description: "Buyer display name from the WhatsApp header or in-text self-ID.",
    },
    delivery_address: {
      type: Type.STRING,
      description: "Delivery location or landmark.",
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          product_id: {
            type: Type.STRING,
            description: "Optional SKU hint. Empty if unknown.",
          },
          product_name: {
            type: Type.STRING,
            description: "Spoken product name from the chat.",
          },
          quantity: {
            type: Type.INTEGER,
            description: "Whole units requested. Default 1.",
          },
        },
        required: ["product_name", "quantity"],
      },
    },
    intent_classification: {
      type: Type.STRING,
      format: "enum",
      enum: ["INQUIRY", "HIGH_PURCHASE_INTENT"],
    },
    payment_signal_detected: {
      type: Type.BOOLEAN,
      description: "True when the chat signals payment or commitment.",
    },
    suggested_status: {
      type: Type.STRING,
      format: "enum",
      enum: ["READY_TO_CONFIRM"],
      nullable: true,
      description: "READY_TO_CONFIRM only when payment language is present. Never a stored order status.",
    },
    amount: {
      type: Type.NUMBER,
      description: "Expense amount in naira. 5k means 5000.",
    },
    category: {
      type: Type.STRING,
      description: "Expense category such as Fuel or Nylon.",
    },
    note: {
      type: Type.STRING,
      description: "Short original expense or restock phrase.",
    },
    qty: {
      type: Type.INTEGER,
      description: "Restock units added.",
    },
    total_cost: {
      type: Type.NUMBER,
      description: "Supplier restock total in naira. 0 if unknown.",
    },
    sku_hint: {
      type: Type.STRING,
      description: "Spoken SKU name for restock.",
    },
    expenses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          amount: {
            type: Type.NUMBER,
            description: "Naira amount. 5k means 5000.",
          },
          category: {
            type: Type.STRING,
            description: "Expense category.",
          },
        },
        required: ["amount", "category"],
      },
    },
  },
  required: [
    "kind",
    "customer_name",
    "delivery_address",
    "items",
    "intent_classification",
    "payment_signal_detected",
  ],
};

export const PARSE_MODEL = "gemini-3.8-flash";
export const PARSE_MODEL_FALLBACK = "gemini-3.5-flash";
