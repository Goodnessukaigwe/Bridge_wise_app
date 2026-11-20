import type { Business } from "@/lib/business";
import { formatMoney, receiptFileName, receiptNumber } from "@/lib/receipt/helpers";
import type { Order } from "@/types/bridgewise";

/**
 * Builds the receipt PDF fully in the browser. jsPDF is imported dynamically
 * (this whole module is only loaded when a receipt is created). Only customer
 * facing facts go in: never cost price, capital, profit or internal IDs.
 */

const INDIGO: [number, number, number] = [23, 16, 74];
const AMBER: [number, number, number] = [245, 158, 11];
const GREEN: [number, number, number] = [16, 185, 129];
const INK: [number, number, number] = [15, 10, 46];
const MUTED: [number, number, number] = [107, 104, 152];
const LINE: [number, number, number] = [230, 227, 245];
const TINT: [number, number, number] = [236, 233, 251];

const PAGE_W = 148;
const PAGE_H = 210;
const M = 12;
const RIGHT = PAGE_W - M;
const FOOTER_Y = PAGE_H - 8;
const BODY_BOTTOM = PAGE_H - 18;

export type ReceiptInput = {
  order: Order;
  business: Business;
  customerPhone?: string;
  /** ms epoch the sale was confirmed; falls back to order creation. */
  paidAt?: number;
};

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function formatWhen(paidAt: number | undefined, dateKey: string): string {
  const d = paidAt
    ? new Date(paidAt)
    : (() => {
        const [y, m, day] = dateKey.split("-").map(Number);
        return new Date(y, (m ?? 1) - 1, day ?? 1);
      })();
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  if (!paidAt) return date;
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}

export async function buildReceiptPdf(
  input: ReceiptInput,
): Promise<{ file: File; usedNairaSign: boolean }> {
  const { order, business } = input;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });

  // Noto Sans (subset, includes the naira sign). If it cannot load we fall
  // back to the built-in font and write "NGN" instead of a broken symbol.
  let family = "helvetica";
  let usedNairaSign = false;
  try {
    const [reg, bold] = await Promise.all([
      fetchBase64("/fonts/NotoSans-Regular.ttf"),
      fetchBase64("/fonts/NotoSans-Bold.ttf"),
    ]);
    doc.addFileToVFS("NotoSans-Regular.ttf", reg);
    doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    doc.addFileToVFS("NotoSans-Bold.ttf", bold);
    doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
    family = "NotoSans";
    usedNairaSign = true;
  } catch {
    /* fall back below */
  }
  const money = (n: number) => formatMoney(n, usedNairaSign);
  const font = (style: "normal" | "bold", size: number) => {
    doc.setFont(family, style);
    doc.setFontSize(size);
  };
  const wrap = (text: string, width: number, maxLines = 3): string[] => {
    const lines = doc.splitTextToSize(text, width) as string[];
    if (lines.length <= maxLines) return lines;
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = `${cut[maxLines - 1].replace(/\s+\S*$/, "")}…`;
    return cut;
  };

  const number = receiptNumber(order.seq);
  const bizName = business.name.trim() || "My business";

  // ---- Bands --------------------------------------------------------------
  const drawFullBand = () => {
    doc.setFillColor(...INDIGO);
    doc.rect(0, 0, PAGE_W, 34, "F");
    doc.setFillColor(...AMBER);
    doc.rect(0, 34, PAGE_W, 1.6, "F");

    let drewLogo = false;
    if (business.logo && business.logoW && business.logoH) {
      const maxW = 46;
      const maxH = 20;
      const scale = Math.min(maxW / business.logoW, maxH / business.logoH);
      try {
        doc.addImage(
          business.logo,
          "PNG",
          M,
          7 + (maxH - business.logoH * scale) / 2,
          business.logoW * scale,
          business.logoH * scale,
        );
        drewLogo = true;
      } catch {
        /* show the name instead */
      }
    }
    if (!drewLogo) {
      doc.setTextColor(255, 255, 255);
      font("bold", 16);
      doc.text(wrap(bizName, 66, 2), M, 15);
    }
    doc.setTextColor(255, 255, 255);
    font("bold", 21);
    doc.text("Receipt", RIGHT, 16, { align: "right" });
    const phone = business.phone.trim();
    if (phone) {
      doc.setTextColor(253, 230, 170);
      font("normal", 9.5);
      doc.text(phone, RIGHT, 24, { align: "right" });
    }
  };

  const drawSlimBand = () => {
    doc.setFillColor(...INDIGO);
    doc.rect(0, 0, PAGE_W, 14, "F");
    doc.setFillColor(...AMBER);
    doc.rect(0, 14, PAGE_W, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    font("bold", 10.5);
    doc.text(wrap(bizName, 80, 1), M, 9);
    font("normal", 9);
    doc.text(`Receipt ${number} (continued)`, RIGHT, 9, { align: "right" });
  };

  const drawFooter = (page: number, pages: number) => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, FOOTER_Y - 5, RIGHT, FOOTER_Y - 5);
    doc.setTextColor(...MUTED);
    font("normal", 8);
    doc.text("Made with OnRecord", PAGE_W / 2, FOOTER_Y, { align: "center" });
    if (pages > 1) {
      doc.text(`Page ${page} of ${pages}`, RIGHT, FOOTER_Y, { align: "right" });
    }
  };

  drawFullBand();

  // ---- Details block ------------------------------------------------------
  let y = 46;
  const detail = (label: string, value: string, maxLines = 3) => {
    if (!value.trim()) return;
    doc.setTextColor(...MUTED);
    font("normal", 8.5);
    doc.text(label, M, y);
    doc.setTextColor(...INK);
    font("bold", 10);
    const lines = wrap(value, 88, maxLines);
    doc.text(lines, 46, y);
    y += Math.max(1, lines.length) * 4.6 + 1.6;
  };
  detail("Receipt no.", number);
  detail("Date", formatWhen(input.paidAt ?? order.created_at, order.date_key));
  detail("Customer", order.customer_name);
  detail("Phone", input.customerPhone ?? "", 1);
  detail("Delivery to", order.delivery_address, 3);

  // ---- Items table --------------------------------------------------------
  const COL_QTY = 86;
  const COL_PRICE = 112;
  const COL_AMOUNT = RIGHT;
  const ITEM_W = COL_QTY - M - 12;

  const tableHeader = () => {
    doc.setFillColor(...TINT);
    doc.roundedRect(M, y, RIGHT - M, 8, 1.5, 1.5, "F");
    doc.setTextColor(...INDIGO);
    font("bold", 8.5);
    doc.text("Item", M + 2.5, y + 5.4);
    doc.text("Qty", COL_QTY, y + 5.4, { align: "right" });
    doc.text("Price", COL_PRICE, y + 5.4, { align: "right" });
    doc.text("Amount", COL_AMOUNT - 2.5, y + 5.4, { align: "right" });
    y += 10;
  };

  y += 2;
  tableHeader();

  const pageBreaks: number[] = [];
  let total = 0;
  for (const line of order.items) {
    const amount = line.unit_selling_price * line.quantity;
    total += amount;
    font("normal", 9.5);
    const nameLines = wrap(line.product_name, ITEM_W, 3);
    const rowH = nameLines.length * 4.4 + 3.4;
    if (y + rowH > BODY_BOTTOM - 36) {
      pageBreaks.push(doc.getNumberOfPages());
      doc.addPage();
      drawSlimBand();
      y = 24;
      tableHeader();
    }
    doc.setTextColor(...INK);
    font("normal", 9.5);
    doc.text(nameLines, M + 2.5, y + 3.6);
    doc.text(String(line.quantity), COL_QTY, y + 3.6, { align: "right" });
    doc.text(money(line.unit_selling_price), COL_PRICE, y + 3.6, {
      align: "right",
    });
    font("bold", 9.5);
    doc.text(money(amount), COL_AMOUNT - 2.5, y + 3.6, { align: "right" });
    y += rowH;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(M, y - 0.6, RIGHT, y - 0.6);
  }

  // ---- Total, Paid, thanks ------------------------------------------------
  y += 4;
  doc.setFillColor(...INDIGO);
  doc.roundedRect(66, y, RIGHT - 66, 13, 2.5, 2.5, "F");
  doc.setTextColor(255, 255, 255);
  font("normal", 10);
  doc.text("Total", 70, y + 8.2);
  font("bold", 14);
  doc.text(money(total), RIGHT - 4, y + 8.8, { align: "right" });

  doc.setFillColor(...GREEN);
  doc.roundedRect(M, y + 1.5, 24, 10, 5, 5, "F");
  doc.setTextColor(255, 255, 255);
  font("bold", 10.5);
  doc.text("Paid", M + 12, y + 8, { align: "center" });
  y += 24;

  doc.setTextColor(...INDIGO);
  font("bold", 11);
  doc.text("Thank you for your order!", M, y);
  doc.setTextColor(...MUTED);
  font("normal", 9);
  const contact = business.phone.trim()
    ? `Questions? Call ${bizName} on ${business.phone.trim()}.`
    : `We appreciate your business with ${bizName}.`;
  doc.text(wrap(contact, RIGHT - M, 2), M, y + 5.5);

  // ---- Footers (need the final page count) --------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    drawFooter(p, pages);
  }

  const blob = doc.output("blob");
  const file = new File([blob], receiptFileName(order.customer_name, order.date_key), {
    type: "application/pdf",
  });
  return { file, usedNairaSign };
}
