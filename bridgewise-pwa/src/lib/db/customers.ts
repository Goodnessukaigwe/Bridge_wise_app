import { isWalkInName } from "@/lib/ai/identity";
import { customerId, db, toIdToken } from "@/lib/db/dexie";
import { findCustomerIn } from "@/lib/db/customerMatch";
import { normalisePhone } from "@/lib/whatsapp";
import type { Customer } from "@/types/bridgewise";

export type UpsertCustomerInput = {
  name: string;
  address?: string;
  /** Phone as typed. A matching number means the same person. */
  phone?: string;
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
 * Insert or merge a customer. Matches an existing customer by phone number
 * first (0803… = 234803…), then by name ignoring case and extra spaces, so
 * there are never duplicates. Placeholder names ("Walk-in / Inquiry #014")
 * never create a customer. Addresses append; preferences are never wiped.
 */
export async function upsertCustomer(
  input: UpsertCustomerInput,
): Promise<Customer | null> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const walkIn = !name || isWalkInName(name) || !toIdToken(name);
  const address = input.address?.trim() ?? "";
  const phoneRaw = input.phone?.trim() ?? "";
  const phone = phoneRaw ? (normalisePhone(phoneRaw) ?? phoneRaw) : "";

  const all = await db.customers.toArray();
  let existing = findCustomerIn(all, { name: walkIn ? "" : name, phone });
  if (!existing && !walkIn) {
    existing = await db.customers.get(customerId(name));
  }

  if (!existing) {
    if (walkIn) return null;
    const created: Customer = {
      customer_id: customerId(name),
      name,
      saved_addresses: address ? [address] : [],
      preferences: [],
      ...(phone ? { phone } : {}),
    };
    await db.customers.add(created);
    return created;
  }

  const saved_addresses = [...existing.saved_addresses];
  if (
    address &&
    !saved_addresses.some((row) => row.toLowerCase() === address.toLowerCase())
  ) {
    saved_addresses.push(address);
  }

  // An existing customer always keeps the name already saved (a match by
  // name differs only in case or spacing; a match by phone is the same person).
  const next: Customer = {
    ...existing,
    saved_addresses,
    preferences: existing.preferences,
    ...(phone ? { phone } : {}),
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
      customer_id: customer.customer_id,
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
 * Saves (or clears) a customer's phone number by id. Writes the customers
 * store only: never stock, the ledger or order status. A valid number is
 * stored as international digits; anything else is kept exactly as typed (it
 * is simply treated as missing when sending). Saving is never blocked.
 */
export async function saveCustomerPhone(
  customer_id: string,
  rawPhone: string,
): Promise<"saved" | "cleared" | "no_customer"> {
  const existing = await db.customers.get(customer_id);
  if (!existing) return "no_customer";
  const trimmed = rawPhone.trim();
  const next: Customer = { ...existing };
  if (trimmed) next.phone = normalisePhone(trimmed) ?? trimmed;
  else delete next.phone;
  await db.customers.put(next);
  return trimmed ? "saved" : "cleared";
}

/** Same, finding (or creating) the customer by name. Walk-ins have no record. */
export async function setCustomerPhone(
  name: string,
  rawPhone: string,
): Promise<"saved" | "cleared" | "no_customer"> {
  if (isWalkInName(name)) return "no_customer";
  const all = await db.customers.toArray();
  const existing =
    findCustomerIn(all, { name }) ?? (await upsertCustomer({ name }));
  if (!existing) return "no_customer";
  return saveCustomerPhone(existing.customer_id, rawPhone);
}
