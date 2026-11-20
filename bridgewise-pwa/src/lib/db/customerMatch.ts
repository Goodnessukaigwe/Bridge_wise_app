import { isWalkInName } from "@/lib/ai/identity";
import { normalisePhone } from "@/lib/whatsapp";
import type { Customer, Order } from "@/types/bridgewise";

/** Lowercase, trimmed, single spaces. */
export function normName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Identity key for a phone number: the last 10 digits of a valid number, so
 * 0803… and 234803… are the same person. Null when the number is not valid.
 */
export function phoneKey(phone: string | undefined | null): string | null {
  const n = normalisePhone(phone);
  return n ? n.slice(-10) : null;
}

/** Finds the saved customer for a name and/or phone. Phone wins, then name. */
export function findCustomerIn(
  customers: Customer[],
  who: { name?: string; phone?: string },
): Customer | undefined {
  const key = phoneKey(who.phone);
  if (key) {
    const byPhone = customers.find((c) => phoneKey(c.phone) === key);
    if (byPhone) return byPhone;
  }
  const name = who.name ? normName(who.name) : "";
  if (name && !isWalkInName(who.name ?? "")) {
    return customers.find((c) => normName(c.name) === name);
  }
  return undefined;
}

export type CustomerIndex = {
  forOrder: (order: Order) => Customer | undefined;
};

/** One definition of "which customer does this order belong to". */
export function buildCustomerIndex(customers: Customer[]): CustomerIndex {
  const byId = new Map<string, Customer>();
  const byName = new Map<string, Customer>();
  const byPhone = new Map<string, Customer>();
  for (const c of customers) {
    byId.set(c.customer_id, c);
    byName.set(normName(c.name), c);
    const k = phoneKey(c.phone);
    if (k) byPhone.set(k, c);
  }
  return {
    forOrder(order) {
      if (order.customer_id) {
        const c = byId.get(order.customer_id);
        if (c) return c;
      }
      if (!isWalkInName(order.customer_name)) {
        const c = byName.get(normName(order.customer_name));
        if (c) return c;
      }
      const k = phoneKey(order.customer_phone);
      return k ? byPhone.get(k) : undefined;
    },
  };
}

const PHONE_QUERY = /^[\d\s+()-]+$/;

/** Does a typed search match this customer by name or phone? */
export function matchesQuery(customer: Customer, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (normName(customer.name).includes(normName(q))) return true;
  if (!PHONE_QUERY.test(q)) return false;
  const digits = q.replace(/\D/g, "");
  if (digits.length < 3) return false;
  const stored = (customer.phone ?? "").replace(/\D/g, "");
  if (!stored) return false;
  // 0803… and 234803… are the same: compare without the leading 0 / 234.
  const needle =
    digits.length >= 10
      ? digits.slice(-10)
      : digits.replace(/^(234|0)+/, "") || digits;
  return stored.includes(needle);
}

export function looksLikePhone(q: string): boolean {
  return PHONE_QUERY.test(q.trim()) && q.replace(/\D/g, "").length >= 3;
}
