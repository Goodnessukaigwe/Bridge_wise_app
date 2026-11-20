import { describe, expect, it } from "vitest";
import type { Customer, Order } from "@/types/bridgewise";
import {
  buildCustomerIndex,
  findCustomerIn,
  matchesQuery,
  phoneKey,
} from "./customerMatch";

const c = (id: string, name: string, phone?: string): Customer => ({
  customer_id: id,
  name,
  saved_addresses: [],
  preferences: [],
  ...(phone ? { phone } : {}),
});

describe("customer matching", () => {
  const list = [c("A", "Chioma Nwosu", "2348031234567"), c("B", "Amaka")];

  it("treats 0803… and 234803… as the same number", () => {
    expect(phoneKey("08031234567")).toBe(phoneKey("+234 803 123 4567"));
  });
  it("matches by phone first, then name ignoring case and spaces", () => {
    expect(findCustomerIn(list, { name: "Someone", phone: "0803 123 4567" })?.customer_id).toBe("A");
    expect(findCustomerIn(list, { name: "  amaka  " })?.customer_id).toBe("B");
    expect(findCustomerIn(list, { name: "Walk-in / Inquiry #014" })).toBeUndefined();
  });
  it("links orders by id, then name, then phone", () => {
    const idx = buildCustomerIndex(list);
    const o = (x: Partial<Order>) => x as Order;
    expect(idx.forOrder(o({ customer_id: "B", customer_name: "x" }))?.customer_id).toBe("B");
    expect(idx.forOrder(o({ customer_name: "CHIOMA  nwosu" }))?.customer_id).toBe("A");
    expect(idx.forOrder(o({ customer_name: "Walk-in / Inquiry #002", customer_phone: "08031234567" }))?.customer_id).toBe("A");
  });
  it("searches by name and by phone in both formats", () => {
    expect(matchesQuery(list[0], "CHIO")).toBe(true);
    expect(matchesQuery(list[0], "0803")).toBe(true);
    expect(matchesQuery(list[0], "234803")).toBe(true);
    expect(matchesQuery(list[0], "08031234567")).toBe(true);
    expect(matchesQuery(list[0], "0803 123-4567")).toBe(true);
    expect(matchesQuery(list[0], "08")).toBe(false);
    expect(matchesQuery(list[1], "0803")).toBe(false);
  });
});
