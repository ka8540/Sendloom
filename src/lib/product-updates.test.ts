import { describe, expect, it } from "vitest";

import {
  generateProductUpdateSlug,
  isSafeProductUpdateCtaHref,
  productUpdateInputSchema,
  productUpdateSeenSchema
} from "@/lib/product-updates";

const validInput = {
  title: "Stay updated with in-app notifications",
  summary: "Important Sendloom updates now arrive directly in your workspace.",
  description: "Sendloom can now notify you when a Discover search finishes.",
  icon: "BELL",
  ctaLabel: "Open dashboard",
  ctaHref: "/workspace"
};

describe("isSafeProductUpdateCtaHref", () => {
  it.each(["/workspace", "/finder", "/imports", "/templates", "/suppressions", "/account", "/prospects", "/campaigns", "/sequences", "/analysis"])(
    "accepts the allow-listed Sendloom destination %s",
    (href) => {
      expect(isSafeProductUpdateCtaHref(href)).toBe(true);
    }
  );

  it.each(["/prospects/abc123", "/campaigns/camp_1-x", "/sequences/seq42", "/analysis/engagement"])(
    "accepts allow-listed sub-routes like %s",
    (href) => {
      expect(isSafeProductUpdateCtaHref(href)).toBe(true);
    }
  );

  it.each([
    "https://evil.com",
    "http://evil.com",
    "//evil.com",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "evil.com",
    "/admin",
    "/unknown-path",
    "/campaigns/../../etc",
    ""
  ])("rejects the unsafe or unknown destination %s", (href) => {
    expect(isSafeProductUpdateCtaHref(href)).toBe(false);
  });
});

describe("productUpdateInputSchema", () => {
  it("accepts a valid draft payload and normalizes the CTA", () => {
    const parsed = productUpdateInputSchema.parse(validInput);
    expect(parsed.title).toBe(validInput.title);
    expect(parsed.ctaHref).toBe("/workspace");
  });

  it("defaults an omitted CTA to null on both sides", () => {
    const { ctaLabel, ctaHref, ...rest } = validInput;
    const parsed = productUpdateInputSchema.parse(rest);
    expect(parsed.ctaLabel).toBeNull();
    expect(parsed.ctaHref).toBeNull();
  });

  it("rejects missing required content", () => {
    expect(() => productUpdateInputSchema.parse({ ...validInput, title: " " })).toThrow();
    expect(() => productUpdateInputSchema.parse({ ...validInput, summary: "" })).toThrow();
    expect(() => productUpdateInputSchema.parse({ ...validInput, description: "" })).toThrow();
  });

  it("enforces the content length ceilings", () => {
    expect(() => productUpdateInputSchema.parse({ ...validInput, title: "x".repeat(101) })).toThrow();
    expect(() => productUpdateInputSchema.parse({ ...validInput, summary: "x".repeat(221) })).toThrow();
    expect(() => productUpdateInputSchema.parse({ ...validInput, description: "x".repeat(5001) })).toThrow();
    expect(() => productUpdateInputSchema.parse({ ...validInput, ctaLabel: "x".repeat(41) })).toThrow();
  });

  it("rejects an external CTA href", () => {
    expect(() => productUpdateInputSchema.parse({ ...validInput, ctaHref: "https://evil.com" })).toThrow(
      /inside Sendloom/
    );
  });

  it("rejects a protocol-relative and a javascript CTA href", () => {
    expect(() => productUpdateInputSchema.parse({ ...validInput, ctaHref: "//evil.com" })).toThrow();
    expect(() => productUpdateInputSchema.parse({ ...validInput, ctaHref: "javascript:alert(1)" })).toThrow();
  });

  it("requires a CTA label and destination together", () => {
    expect(() => productUpdateInputSchema.parse({ ...validInput, ctaLabel: "Open", ctaHref: null })).toThrow(/both/);
    expect(() => productUpdateInputSchema.parse({ ...validInput, ctaLabel: null, ctaHref: "/account" })).toThrow(/both/);
  });

  it("rejects unknown fields and unknown icons", () => {
    expect(() => productUpdateInputSchema.parse({ ...validInput, html: "<b>x</b>" })).toThrow();
    expect(() => productUpdateInputSchema.parse({ ...validInput, icon: "ROCKET" })).toThrow();
  });
});

describe("productUpdateSeenSchema", () => {
  it("accepts a list of ids", () => {
    expect(productUpdateSeenSchema.parse({ ids: ["a", "b"] }).ids).toEqual(["a", "b"]);
  });

  it("rejects an empty list and extra fields such as a client-supplied userId", () => {
    expect(() => productUpdateSeenSchema.parse({ ids: [] })).toThrow();
    expect(() => productUpdateSeenSchema.parse({ ids: ["a"], userId: "someone-else" })).toThrow();
  });
});

describe("generateProductUpdateSlug", () => {
  it("builds a unique url-safe slug from the title", () => {
    const one = generateProductUpdateSlug("In-app Notifications!");
    const two = generateProductUpdateSlug("In-app Notifications!");
    expect(one).toMatch(/^in-app-notifications-[a-f0-9]{8}$/);
    expect(two).not.toBe(one);
  });
});
