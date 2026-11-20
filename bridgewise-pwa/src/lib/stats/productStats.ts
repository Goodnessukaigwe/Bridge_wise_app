import type { LedgerEntry, Order } from "@/types/bridgewise";

/** Read-only maths for "How your products are doing". No writes, no new stores. */

export type Period = "today" | "week" | "month";

export const PERIOD_DAYS: Record<Period, number> = {
  today: 1,
  week: 7,
  month: 30,
};

export type SaleLine = {
  dateKey: string;
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  profit: number;
};

export type Bar = { label: string; value: number; highlight: boolean };

export type ProductRow = {
  productId: string;
  name: string;
  units: number;
  revenue: number;
  profit: number;
  prevUnits: number;
  trend: number[];
};

export type Summary = {
  rows: ProductRow[];
  revenue: number;
  prevRevenue: number;
  units: number;
  bestSeller: ProductRow | null;
  topProfit: ProductRow | null;
  bars: Bar[];
};

function toDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftDateKey(key: string, days: number): string {
  const d = toDate(key);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

/** Sold orders only (returns are excluded), dated by the sale's ledger entry. */
export function buildSaleLines(
  entries: LedgerEntry[],
  orders: Order[],
): SaleLine[] {
  const byId = new Map(orders.map((o) => [o.order_id, o]));
  const lines: SaleLine[] = [];
  for (const entry of entries) {
    if (entry.entry_type !== "SALE" || !entry.ref_order_id) continue;
    const order = byId.get(entry.ref_order_id);
    if (!order || order.status !== "CONFIRMED_SALE") continue;
    for (const item of order.items) {
      const revenue = item.unit_selling_price * item.quantity;
      lines.push({
        dateKey: entry.date_key,
        productId: item.product_id || item.product_name,
        name: item.product_name,
        qty: item.quantity,
        revenue,
        profit: revenue - item.unit_cost_price * item.quantity,
      });
    }
  }
  return lines;
}

function inRange(key: string, from: string, to: string): boolean {
  return key >= from && key <= to;
}

function dailySeries(lines: SaleLine[], today: string, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  const first = shiftDateKey(today, -(days - 1));
  for (const l of lines) {
    if (!inRange(l.dateKey, first, today)) continue;
    const idx = Math.round(
      (toDate(l.dateKey).getTime() - toDate(first).getTime()) / 86_400_000,
    );
    if (idx >= 0 && idx < days) out[idx] += l.revenue;
  }
  return out;
}

/** Days of trend shown: "today" borrows the last week so the line has shape. */
export function trendDays(period: Period): number {
  return period === "today" ? 7 : PERIOD_DAYS[period];
}

export function buildBars(
  lines: SaleLine[],
  period: Period,
  today: string,
): Bar[] {
  if (period === "month") {
    const daily = dailySeries(lines, today, 30);
    const bars: Bar[] = [];
    for (let b = 0; b < 6; b++) {
      const slice = daily.slice(b * 5, b * 5 + 5);
      const startKey = shiftDateKey(today, -(29 - b * 5));
      bars.push({
        label: toDate(startKey).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
        value: slice.reduce((s, v) => s + v, 0),
        highlight: b === 5,
      });
    }
    return bars;
  }
  const daily = dailySeries(lines, today, 7);
  return daily.map((value, i) => ({
    label: toDate(shiftDateKey(today, -(6 - i))).toLocaleDateString("en-GB", {
      weekday: "short",
    }),
    value,
    highlight: i === 6,
  }));
}

export function summarise(
  lines: SaleLine[],
  period: Period,
  today: string,
): Summary {
  const days = PERIOD_DAYS[period];
  const from = shiftDateKey(today, -(days - 1));
  const prevTo = shiftDateKey(today, -days);
  const prevFrom = shiftDateKey(today, -(2 * days - 1));

  const rows = new Map<string, ProductRow>();
  let revenue = 0;
  let prevRevenue = 0;
  let units = 0;

  for (const l of lines) {
    const cur = inRange(l.dateKey, from, today);
    const prev = inRange(l.dateKey, prevFrom, prevTo);
    if (!cur && !prev) continue;
    let row = rows.get(l.productId);
    if (!row) {
      row = {
        productId: l.productId,
        name: l.name,
        units: 0,
        revenue: 0,
        profit: 0,
        prevUnits: 0,
        trend: [],
      };
      rows.set(l.productId, row);
    }
    if (cur) {
      row.units += l.qty;
      row.revenue += l.revenue;
      row.profit += l.profit;
      revenue += l.revenue;
      units += l.qty;
    } else {
      row.prevUnits += l.qty;
      prevRevenue += l.revenue;
    }
  }

  const trendLen = trendDays(period);
  const ranked = [...rows.values()]
    .filter((r) => r.units > 0)
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  for (const r of ranked) {
    r.trend = dailySeries(
      lines.filter((l) => l.productId === r.productId),
      today,
      trendLen,
    );
  }

  const bestSeller =
    [...ranked].sort((a, b) => b.units - a.units || b.revenue - a.revenue)[0] ??
    null;
  const topProfit = [...ranked].sort((a, b) => b.profit - a.profit)[0] ?? null;

  return {
    rows: ranked,
    revenue,
    prevRevenue,
    units,
    bestSeller,
    topProfit,
    bars: buildBars(lines, period, today),
  };
}

export type Tone = "up" | "down" | "same";

export function periodWord(period: Period): string {
  return period === "today"
    ? "yesterday"
    : period === "week"
      ? "last week"
      : "last month";
}

/** Plain-words comparison for one product (units sold). */
export function compareProduct(
  units: number,
  prevUnits: number,
  period: Period,
): { tone: Tone; text: string } {
  const word = periodWord(period);
  if (prevUnits === 0 && units > 0) {
    return { tone: "up", text: `New seller: nothing sold ${word}` };
  }
  if (units > prevUnits) {
    return { tone: "up", text: `Selling faster than ${word}` };
  }
  if (units < prevUnits) {
    return { tone: "down", text: `Slower than ${word}` };
  }
  return { tone: "same", text: `Same as ${word}` };
}

/** Plain-words comparison for all sales (money). */
export function compareTotal(
  revenue: number,
  prevRevenue: number,
  period: Period,
): { tone: Tone; text: string } {
  const word = periodWord(period);
  if (prevRevenue === 0 && revenue > 0) {
    return { tone: "up", text: `You made money. Nothing was sold ${word}` };
  }
  if (revenue > prevRevenue) {
    return { tone: "up", text: `You sold more than ${word}` };
  }
  if (revenue < prevRevenue) {
    return { tone: "down", text: `You sold less than ${word}` };
  }
  return { tone: "same", text: `About the same as ${word}` };
}

export function shortNaira(n: number): string {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `₦${Math.round(n)}`;
}
