import { isWalkInName } from "@/lib/ai/identity";
import { normalisePhone, whatsappUrl } from "@/lib/whatsapp";
import type { Order, OrderLine } from "@/types/bridgewise";

const naira = new Intl.NumberFormat("en-NG");

export type ShareReceiptResult =
  | { status: "whatsapp" }
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

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** Customer-facing WhatsApp receipt. Never includes cost, capital, or profit. */
export function buildReceiptText(order: Order): string {
  const total = order.items.reduce((sum, line) => sum + lineTotal(line), 0);
  const delivery = order.delivery_address.trim();
  const name = order.customer_name.trim();
  const greeting =
    name && !isWalkInName(name) ? `Hello ${name},` : "Hello,";

  const lines = [
    `${greeting} here is your receipt.`,
    "",
    `Date: ${formatDate(order.date_key)}`,
    "",
    ...order.items.map(itemLine),
    "",
    `Total: ${formatNaira(total)}`,
  ];
  if (delivery) lines.push(`Delivery: ${delivery}`);
  lines.push("", "Thank you for your order!", "Sent with OnRecord");
  return lines.join("\n");
}

/** Opens a link from a tap. Returns false when the browser blocked it. */
function openLink(url: string): boolean {
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win) return true;
  // Some browsers (notably iOS Safari) block window.open; navigate instead.
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}

/**
 * One-tap WhatsApp receipt using click-to-chat links only.
 * - Saved number: opens that customer's chat directly.
 * - No number: Web Share sheet if available, else wa.me chat picker.
 * Call this straight from the tap handler (no awaits before it) so iOS
 * allows the link to open. Not a Dexie write: stock, money and order status
 * are never touched.
 */
export async function shareReceipt(
  order: Order,
  phone?: string | null,
): Promise<ShareReceiptResult> {
  const text = buildReceiptText(order);

  if (normalisePhone(phone)) {
    if (openLink(whatsappUrl(text, phone))) return { status: "whatsapp" };
  } else if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({ title: "Receipt", text });
      return { status: "shared" };
    } catch (err) {
      if (isAbortError(err)) return { status: "cancelled" };
    }
  } else if (openLink(whatsappUrl(text, null))) {
    return { status: "whatsapp" };
  }

  try {
    if (!navigator.clipboard?.writeText) {
      return {
        status: "error",
        message: "Sharing does not work on this phone. Please try again.",
      };
    }
    await navigator.clipboard.writeText(text);
    return { status: "copied" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Could not share the receipt",
    };
  }
}
