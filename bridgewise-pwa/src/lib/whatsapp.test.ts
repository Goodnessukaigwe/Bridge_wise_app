import { describe, expect, it } from "vitest";
import { extractPhone, formatPhoneDisplay, normalisePhone, whatsappUrl } from "./whatsapp";

describe("normalisePhone", () => {
  it("handles common Nigerian formats", () => {
    expect(normalisePhone("0803 123 4567")).toBe("2348031234567");
    expect(normalisePhone("+234 (803) 123-4567")).toBe("2348031234567");
    expect(normalisePhone("2348031234567")).toBe("2348031234567");
    expect(normalisePhone("8031234567")).toBe("2348031234567");
    expect(normalisePhone("+234 (0) 803 123 4567")).toBe("2348031234567");
  });
  it("treats rubbish as missing", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("abc")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("234803123")).toBeNull();
  });
  it("accepts other international numbers", () => {
    expect(normalisePhone("+44 7700 900123")).toBe("447700900123");
  });
});

describe("whatsappUrl", () => {
  it("keeps line breaks and encodes text", () => {
    const url = whatsappUrl("Hi\nTotal ₦5,000", "08031234567");
    expect(url).toBe(
      "https://wa.me/2348031234567?text=Hi%0ATotal%20%E2%82%A65%2C000",
    );
  });
  it("falls back to the chat picker without a number", () => {
    expect(whatsappUrl("Hi", "nope")).toBe("https://wa.me/?text=Hi");
  });
});

describe("extractPhone", () => {
  it("finds the number inside copied contact text", () => {
    expect(extractPhone("Chioma Nwosu\n+234 803 123 4567")).toBe("2348031234567");
    expect(extractPhone("mobile (0803) 123-4567 home")).toBe("2348031234567");
  });
  it("returns null when there is no number", () => {
    expect(extractPhone("Chioma Nwosu")).toBeNull();
    expect(extractPhone("")).toBeNull();
  });
});

describe("formatPhoneDisplay", () => {
  it("shows Nigerian numbers locally and keeps odd input", () => {
    expect(formatPhoneDisplay("2348031234567")).toBe("0803 123 4567");
    expect(formatPhoneDisplay("447700900123")).toBe("+447700900123");
    expect(formatPhoneDisplay("call me")).toBe("call me");
    expect(formatPhoneDisplay(undefined)).toBe("");
  });
});
