/** Pure helpers for receipts (no jsPDF here, so they are cheap to import and test). */

/** Friendly receipt number from the order sequence: 4 -> "004". Never the internal key. */
export function receiptNumber(seq: number): string {
  return String(Math.max(0, Math.trunc(seq))).padStart(3, "0");
}

/** Receipt-Chioma-Nwosu-2026-11-12.pdf with unsafe characters removed. */
export function receiptFileName(customerName: string, dateKey: string): string {
  const safe = customerName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `Receipt-${safe || "Customer"}-${dateKey}.pdf`;
}

const nairaFmt = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 });

/** `₦15,000`, or `NGN 15,000` when the PDF font cannot draw the naira sign. */
export function formatMoney(amount: number, symbol = true): string {
  return `${symbol ? "₦" : "NGN "}${nairaFmt.format(amount)}`;
}

export function friendlyMessage(customerName: string): string {
  const first = customerName.trim().split(/\s+/)[0];
  return first && !/^walk-?in/i.test(first)
    ? `Hello ${first}, thank you for your order! Here is your receipt.`
    : "Thank you for your order! Here is your receipt.";
}
