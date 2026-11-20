import { describe, expect, it } from "vitest";
import {
  formatMoney,
  friendlyMessage,
  receiptFileName,
  receiptNumber,
} from "./helpers";

describe("receipt helpers", () => {
  it("pads the receipt number", () => {
    expect(receiptNumber(4)).toBe("004");
    expect(receiptNumber(123)).toBe("123");
  });
  it("builds a safe file name", () => {
    expect(receiptFileName("Chioma Nwosu", "2026-11-12")).toBe(
      "Receipt-Chioma-Nwosu-2026-11-12.pdf",
    );
    expect(receiptFileName("Ọlá/..\\<>:é", "2026-11-12")).toBe(
      "Receipt-Ola-e-2026-11-12.pdf",
    );
    expect(receiptFileName("???", "2026-11-12")).toBe(
      "Receipt-Customer-2026-11-12.pdf",
    );
  });
  it("formats money with a fallback", () => {
    expect(formatMoney(1500000)).toBe("₦1,500,000");
    expect(formatMoney(15000, false)).toBe("NGN 15,000");
  });
  it("greets by first name", () => {
    expect(friendlyMessage("Chioma Nwosu")).toContain("Hello Chioma");
  });
});
