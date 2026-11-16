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
export const PARSE_SYSTEM_INSTRUCTION = `You extract structured events from short notes and WhatsApp chats used by Nigerian social-commerce vendors.

Language: informal Nigerian English and Pidgin (abeg, I wan buy, how much, una get, transfer don go, I go pay now, send am, e don enter, 5k, 3k).

First set kind:
- "expense": the VENDOR is logging a business cash-out that is NOT buying stock and NOT a customer order. Examples: "Fuel 5k", "nylon 3k", "Fuel 5k, nylon 3k", transport, fare, data, airtime, generator, packaging, "spent 5k on fuel".
- "restock": stock arrived from a supplier. Examples: "Restocked 20 Ankara", "supplier brought 10 bags", "add 20 black shoes".
- "order": a customer inquiry or purchase (WhatsApp chat about sending goods, price, payment).

Naira: "5k" = 5000, "3k" = 3000, "1.5k" = 1500, "₦5,000" = 5000. Always output naira numbers, never the k shorthand.

When kind is "expense":
- amount: naira for a single cost. 0 if using expenses[].
- category: Fuel, Nylon, Transport, etc.
- note: short original phrase.
- expenses: one object per cost when several appear ("Fuel 5k, nylon 3k" → two rows).
- items: empty array.
- customer_name and delivery_address: empty.

When kind is "restock":
- qty: whole units added.
- sku_hint / items[0].product_name: spoken product (e.g. "Ankara", "black shoes").
- items[0].quantity equals qty when a product is named.
- total_cost: naira paid to the supplier, or 0 if not mentioned.
- customer_name and delivery_address: empty.

When kind is "order" (customer chat):
- customer_name: WhatsApp header name such as "[11/12, 10:15 AM] Amaka:" or in-text self-ID ("this is Tunde from Ikeja"). Empty string if unknown.
- delivery_address: location phrases (Lekki Phase 1, Ikeja, "my house for Surulere"). Empty string if none.
- items: each product with quantity. Default quantity to 1 when implied ("send the bag"). product_name is the spoken name (e.g. "black bags"). product_id is a SKU-like hint if obvious, otherwise empty.
- payment_signal_detected: true for payment or commitment language — "transfer sent", "transfer don go", "I have paid", "I go pay", "POS", "cash on delivery", "send account".
- intent_classification: HIGH_PURCHASE_INTENT when they are buying, sending, or paying. INQUIRY when asking price, availability, or window-shopping ("how much", "una get?", "just checking").
- suggested_status: READY_TO_CONFIRM only when payment_signal_detected is true.

This is extraction only. Never confirm a sale. Never deduct stock. Never mark a ledger committed.
Never classify fuel, nylon, transport, or supplier restock as an order.`;

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

/** Plan model. Newer Google AI Studio keys may only allow the fallback. */
export const PARSE_MODEL = "gemini-2.5-flash";
export const PARSE_MODEL_FALLBACK = "gemini-3.8-flash";
