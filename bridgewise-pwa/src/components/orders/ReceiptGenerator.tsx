import type { Order, OrderLine } from "@/types/bridgewise";

const naira = new Intl.NumberFormat("en-NG");

export type ShareReceiptResult =
  | { status: "shared" }
  | { status: "copied" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

function formatNaira(amount: number): string {
  return `₦${naira.format(amount)}`;
}

function lineTotal(line: OrderLine): number {
  return line.unit_selling_price * line.quantity;
}

function itemLine(line: OrderLine): string {
  return `${line.quantity} x ${line.product_name} @ ${formatNaira(line.unit_selling_price)} = ${formatNaira(lineTotal(line))}`;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** Customer-facing WhatsApp receipt. Never includes cost, capital, or profit. */
export function buildReceiptText(order: Order): string {
  const items = order.items.map(itemLine);
  const total = order.items.reduce((sum, line) => sum + lineTotal(line), 0);
  const delivery = order.delivery_address.trim();

  const lines = [
    "BridgeWise receipt",
    "",
    order.customer_name,
    ...items,
    "",
    `Total ${formatNaira(total)}`,
  ];

  if (delivery) {
    lines.push(`Delivery: ${delivery}`);
  }

  lines.push("Thank you.");
  return lines.join("\n");
}

/**
 * Opens the Web Share sheet, or copies text if share is unavailable.
 * Not a Dexie write — cancel/dismiss must not touch stock or the ledger.
 */
export async function shareReceipt(order: Order): Promise<ShareReceiptResult> {
  const text = buildReceiptText(order);

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "BridgeWise receipt", text });
      return { status: "shared" };
    } catch (err) {
      if (isAbortError(err)) {
        return { status: "cancelled" };
      }
    }
  }

  try {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== "function"
    ) {
      return { status: "error", message: "Sharing is not available here." };
    }
    await navigator.clipboard.writeText(text);
    return { status: "copied" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Could not share receipt",
    };
  }
}
