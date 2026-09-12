import { describe, expect, it } from "vitest";
import { assertDeliverableEmail, isValidEmailSyntax, normalizeEmail } from "@/lib/email/address";
import { ServiceError } from "@/services/types";

describe("isValidEmailSyntax", () => {
  it("accepts ordinary work addresses", () => {
    for (const ok of [
      "aung@example.com",
      "aung.aung@sub.example.co.uk",
      "a+tag@example.io",
      "AUNG@EXAMPLE.COM",
    ]) {
      expect(isValidEmailSyntax(ok)).toBe(true);
    }
  });

  it("rejects malformed values", () => {
    for (const bad of [
      "",
      "aung",
      "aung@",
      "@example.com",
      "aung@@example.com",
      "aung@example",
      "aung example@x.com",
      "aung@example..com",
      "aung@-example.com",
      `${"a".repeat(65)}@example.com`,
    ]) {
      expect(isValidEmailSyntax(bad)).toBe(false);
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Aung@Example.COM ")).toBe("aung@example.com");
  });
});

describe("assertDeliverableEmail", () => {
  it("passes for a domain that actually receives mail", async () => {
    await expect(assertDeliverableEmail("test@gmail.com")).resolves.toBeUndefined();
  });

  it("rejects a domain with no mail exchanger", async () => {
    // `.invalid` is reserved by RFC 6761 to never resolve.
    await expect(assertDeliverableEmail("someone@nonexistent.invalid")).rejects.toBeInstanceOf(
      ServiceError,
    );
  });

  it("rejects a disposable-inbox provider", async () => {
    await expect(assertDeliverableEmail("burner@mailinator.com")).rejects.toBeInstanceOf(
      ServiceError,
    );
  });

  it("rejects malformed syntax before any lookup", async () => {
    await expect(assertDeliverableEmail("not-an-email")).rejects.toBeInstanceOf(ServiceError);
  });
});
