import type { ToolDef } from "./types";

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const PERIOD = {
  type: "string",
  enum: ["today", "week", "month"],
  description: "today, week (last 7 days) or month (last 30 days)",
};

const ITEMS = {
  type: "array",
  items: {
    type: "object",
    properties: {
      product: str("Product as the customer said it. Spelling can be rough."),
      quantity: num("Whole number. Use 1 only if the customer clearly meant one."),
    },
    required: ["product", "quantity"],
  },
};

/**
 * Compact tool list. `level` is enforced by the phone's executor in code;
 * the model never sees it as something it can change.
 */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: "search_customers",
    level: "read",
    description: "Find saved customers by name or phone.",
    parameters: {
      type: "object",
      properties: { query: str("Name or part of a phone number. Empty = recent.") },
      required: ["query"],
    },
  },
  {
    name: "get_customer_history",
    level: "read",
    description: "A customer's past orders and spend. Use customer_ref from search_customers.",
    parameters: {
      type: "object",
      properties: { customer_ref: str("customer_ref from search_customers") },
      required: ["customer_ref"],
    },
  },
  {
    name: "list_orders",
    level: "read",
    description: "List orders, newest first.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "sold", "cancelled", "expired", "refunded", "all"],
        },
        customer: str("Optional customer name filter"),
        date: str("Optional YYYY-MM-DD"),
        limit: num("Max rows, default 8"),
      },
    },
  },
  {
    name: "get_order",
    level: "read",
    description: "Full detail of one order.",
    parameters: {
      type: "object",
      properties: { order_ref: str("order_ref from list_orders or create_pending_order") },
      required: ["order_ref"],
    },
  },
  {
    name: "list_products",
    level: "read",
    description: "List products in the Stock Room with price and quantity.",
    parameters: {
      type: "object",
      properties: { query: str("Optional name filter") },
    },
  },
  {
    name: "get_stock",
    level: "read",
    description: "Check how many of a product are left. Tolerates spelling mistakes.",
    parameters: {
      type: "object",
      properties: { product: str("Product name as said") },
      required: ["product"],
    },
  },
  {
    name: "get_pocket_statement",
    level: "read",
    description: "Sales, protected capital, expenses and profit.",
    parameters: { type: "object", properties: { period: PERIOD } },
  },
  {
    name: "get_product_performance",
    level: "read",
    description: "Best sellers and revenue per product.",
    parameters: { type: "object", properties: { period: PERIOD } },
  },
  {
    name: "create_pending_order",
    level: "safe_write",
    description:
      "Save a customer enquiry as a NOT PAID pending order. Never changes stock or money. If a product is not in the Stock Room it is NOT created: ask the vendor.",
    parameters: {
      type: "object",
      properties: {
        customer_name: str("Customer name. Empty if unknown."),
        items: ITEMS,
        delivery_address: str("Optional"),
        customer_phone: str("Optional"),
        customer_says_paid: {
          type: "boolean",
          description: "True only if the customer SAYS they paid. This is never proof.",
        },
      },
      required: ["customer_name", "items"],
    },
  },
  {
    name: "update_pending_order",
    level: "safe_write",
    description: "Change a pending (not paid) order. Replaces items if given.",
    parameters: {
      type: "object",
      properties: {
        order_ref: str("order_ref"),
        customer_name: str("Optional"),
        items: ITEMS,
        delivery_address: str("Optional"),
        customer_phone: str("Optional"),
      },
      required: ["order_ref"],
    },
  },
  {
    name: "save_customer_phone",
    level: "safe_write",
    description: "Save a phone number for a customer.",
    parameters: {
      type: "object",
      properties: {
        customer_name: str("Customer name"),
        phone: str("Phone number as written"),
      },
      required: ["customer_name", "phone"],
    },
  },
  {
    name: "confirm_sale",
    level: "approval",
    description:
      "Mark a pending order as sold: takes stock and books the money. The vendor must tap Approve. Only use when the vendor says so.",
    parameters: {
      type: "object",
      properties: { order_ref: str("order_ref") },
      required: ["order_ref"],
    },
  },
  {
    name: "cancel_order",
    level: "approval",
    description: "Cancel a pending order. Needs the vendor's tap.",
    parameters: {
      type: "object",
      properties: { order_ref: str("order_ref") },
      required: ["order_ref"],
    },
  },
  {
    name: "delete_orders",
    level: "approval",
    description: "Delete pending or cancelled orders for good. Needs the vendor's tap.",
    parameters: {
      type: "object",
      properties: { order_refs: { type: "array", items: { type: "string" } } },
      required: ["order_refs"],
    },
  },
  {
    name: "process_return",
    level: "approval",
    description: "Return a sold order: puts stock back and reverses the money. Needs the vendor's tap.",
    parameters: {
      type: "object",
      properties: { order_ref: str("order_ref") },
      required: ["order_ref"],
    },
  },
  {
    name: "log_restock",
    level: "approval",
    description: "Add stock that came in from a supplier and record the cost. Needs the vendor's tap.",
    parameters: {
      type: "object",
      properties: {
        product: str("Product name as said"),
        quantity: num("How many came in"),
        total_cost: num("Total naira paid for the batch. 0 if unknown."),
      },
      required: ["product", "quantity", "total_cost"],
    },
  },
  {
    name: "log_expense",
    level: "approval",
    description: "Record money the vendor spent (fuel, transport, data). Needs the vendor's tap.",
    parameters: {
      type: "object",
      properties: {
        amount: num("Naira, e.g. 5k = 5000"),
        category: str("Fuel, Transport, Data, Packaging..."),
        note: str("Optional"),
      },
      required: ["amount", "category"],
    },
  },
  {
    name: "create_product",
    level: "approval",
    description: "Add a new product to the Stock Room. Ask the vendor first. Needs their tap.",
    parameters: {
      type: "object",
      properties: {
        name: str("Product name"),
        variant: str("Size, colour or type. Use Std if none."),
        cost_price: num("What it cost per piece"),
        selling_price: num("Selling price per piece"),
        quantity: num("How many in stock now"),
      },
      required: ["name", "cost_price", "selling_price", "quantity"],
    },
  },
  {
    name: "update_product",
    level: "approval",
    description: "Change a product's name or prices. Never changes the stock count. Needs the vendor's tap.",
    parameters: {
      type: "object",
      properties: {
        product: str("Product name as said"),
        name: str("New name, optional"),
        cost_price: num("Optional"),
        selling_price: num("Optional"),
      },
      required: ["product"],
    },
  },
];

export const TOOL_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(
  TOOL_DEFS.map((t) => [t.name, t]),
);

export function levelOf(name: string) {
  return TOOL_BY_NAME.get(name)?.level;
}

export const APPROVAL_TOOLS: ReadonlySet<string> = new Set(
  TOOL_DEFS.filter((t) => t.level === "approval").map((t) => t.name),
);

/** What the server sees: names, descriptions, schemas. */
export function wireTools() {
  return TOOL_DEFS.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}
