import { db } from "@/lib/db/dexie";
import { buildCustomerIndex, matchesQuery } from "@/lib/db/customerMatch";
import type { Customer } from "@/types/bridgewise";

export type CustomerSummary = {
  customer: Customer;
  orders: number;
  /** date_key (YYYY-MM-DD) of their newest order, or null if none. */
  lastDate: string | null;
};

/**
 * Local search over saved customers (IndexedDB only, works offline).
 * Empty query returns the most recent customers.
 */
export async function searchCustomers(
  query: string,
  limit = 20,
): Promise<CustomerSummary[]> {
  const [customers, orders] = await Promise.all([
    db.customers.toArray(),
    db.orders.toArray(),
  ]);
  const index = buildCustomerIndex(customers);
  const stats = new Map<string, { orders: number; lastDate: string | null }>();
  for (const o of orders) {
    const c = index.forOrder(o);
    if (!c) continue;
    const s = stats.get(c.customer_id) ?? { orders: 0, lastDate: null };
    s.orders += 1;
    if (!s.lastDate || o.date_key > s.lastDate) s.lastDate = o.date_key;
    stats.set(c.customer_id, s);
  }
  return customers
    .filter((c) => matchesQuery(c, query))
    .map((customer) => ({
      customer,
      orders: stats.get(customer.customer_id)?.orders ?? 0,
      lastDate: stats.get(customer.customer_id)?.lastDate ?? null,
    }))
    .sort((a, b) => {
      if (a.lastDate !== b.lastDate) {
        if (!a.lastDate) return 1;
        if (!b.lastDate) return -1;
        return b.lastDate.localeCompare(a.lastDate);
      }
      return a.customer.name.localeCompare(b.customer.name);
    })
    .slice(0, limit);
}

export function formatShortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
