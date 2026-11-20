import { isWalkInName } from "@/lib/ai/identity";
import { customerId, db, toIdToken } from "@/lib/db/dexie";
import { normalisePhone } from "@/lib/whatsapp";
import type { Customer } from "@/types/bridgewise";

export type UpsertCustomerInput = {
  name: string;
  address?: string;
};

export type AttachCustomerResult =
  | { ok: true; outcome: "attached"; order_id: string }
  | {
      ok: true;
      outcome: "noop";
      reason:
        | "missing_order"
        | "missing_customer"
        | "not_pending"
        | "already_committed"
        | "not_walk_in";
    };

/**
 * Insert or merge a directory row. Same token → same `CUST_…` id.
 * Addresses append; preferences are never wiped.
 */
export async function upsertCustomer(
  input: UpsertCustomerInput,
): Promise<Customer | null> {
  const name = input.name.trim();
  if (!name || isWalkInName(name) || !toIdToken(name)) return null;

  const customer_id = customerId(name);
  const address = input.address?.trim() ?? "";
  const existing = await db.customers.get(customer_id);

  if (!existing) {
    const created: Customer = {
      customer_id,
      name,
      saved_addresses: address ? [address] : [],
      preferences: [],
    };
    await db.customers.add(created);
    return created;
  }

  const saved_addresses = [...existing.saved_addresses];
  if (
    address &&
    !saved_addresses.some(
      (row) => row.toLowerCase() === address.toLowerCase(),
    )
  ) {
    saved_addresses.push(address);
  }

  const next: Customer = {
    ...existing,
    name: existing.name.length >= name.length ? existing.name : name,
    saved_addresses,
    preferences: existing.preferences,
  };
  await db.customers.put(next);
  return next;
}

/**
 * Walk-in picker. Rewrites the pending order’s name (and empty address)
 * only. Never touches inventory or the ledger.
 */
export async function attachCustomerToWalkInOrder(
  orderId: string,
  customer_id: string,
): Promise<AttachCustomerResult> {
  return db.transaction("rw", [db.orders, db.customers], async () => {
    const order = await db.orders.get(orderId);
    if (!order) {
      return { ok: true, outcome: "noop", reason: "missing_order" };
    }
    if (order.ledger_committed) {
      return { ok: true, outcome: "noop", reason: "already_committed" };
    }
    if (order.status !== "PENDING_INQUIRY") {
      return { ok: true, outcome: "noop", reason: "not_pending" };
    }
    if (!isWalkInName(order.customer_name)) {
      return { ok: true, outcome: "noop", reason: "not_walk_in" };
    }

    const customer = await db.customers.get(customer_id);
    if (!customer) {
      return { ok: true, outcome: "noop", reason: "missing_customer" };
    }

    const delivery_address =
      order.delivery_address.trim() || customer.saved_addresses[0] || "";

    await db.orders.update(order.order_id, {
      customer_name: customer.name,
      delivery_address,
    });

    if (order.delivery_address.trim()) {
      await upsertCustomer({
        name: customer.name,
        address: order.delivery_address,
      });
    }

    return { ok: true, outcome: "attached", order_id: order.order_id };
  });
}

/**
 * Saves (or clears) a customer's WhatsApp number. Writes the customers store
 * only: never stock, the ledger or order status. An invalid number is treated
 * as missing (returns "invalid") and nothing is blocked.
 */
export async function setCustomerPhone(
  name: string,
  rawPhone: string,
): Promise<"saved" | "cleared" | "invalid" | "no_customer"> {
  if (isWalkInName(name)) return "no_customer";
  const trimmed = rawPhone.trim();
  const phone = trimmed ? normalisePhone(trimmed) : null;
  if (trimmed && !phone) return "invalid";
  const existing =
    (await db.customers.get(customerId(name))) ??
    (await upsertCustomer({ name }));
  if (!existing) return "no_customer";
  const next: Customer = { ...existing };
  if (phone) next.phone = phone;
  else delete next.phone;
  await db.customers.put(next);
  return phone ? "saved" : "cleared";
}
