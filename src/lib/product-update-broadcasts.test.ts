import { describe, expect, it } from "vitest";

import {
  PRODUCT_UPDATE_CONFIRMATION_PHRASE,
  normalizeProductUpdateCtaHref,
  productUpdateBroadcastInputSchema,
  sendNowProductUpdateBroadcastSchema
} from "@/lib/product-update-broadcasts";

function feature(index = 1) {
  return {
    title: `Feature ${index}`,
    description: `Description ${index}`,
    ctaLabel: "Open Sendloom",
    ctaHref: "/workspace"
  };
}

function input(count = 1) {
  return {
    subject: "New in Sendloom: Better workflows",
    headline: "A better way to work",
    intro: "We shipped a set of improvements for your workspace.",
    features: Array.from({ length: count }, (_, index) => feature(index + 1)),
    scheduledSendAt: null,
    timeZone: "America/Phoenix"
  };
}

describe("product update broadcast validation", () => {
  it.each([1, 2, 5])("accepts %s feature blocks", (count) => {
    expect(productUpdateBroadcastInputSchema.parse(input(count)).features).toHaveLength(count);
  });

  it("rejects zero or more than five features and enforces all content limits", () => {
    expect(productUpdateBroadcastInputSchema.safeParse({ ...input(), features: [] }).success).toBe(false);
    expect(productUpdateBroadcastInputSchema.safeParse(input(6)).success).toBe(false);
    expect(productUpdateBroadcastInputSchema.safeParse({ ...input(), subject: "s".repeat(161) }).success).toBe(false);
    expect(productUpdateBroadcastInputSchema.safeParse({ ...input(), headline: "h".repeat(141) }).success).toBe(false);
    expect(productUpdateBroadcastInputSchema.safeParse({ ...input(), intro: "i".repeat(1501) }).success).toBe(false);
    expect(productUpdateBroadcastInputSchema.safeParse({ ...input(), subject: "hello\r\nBcc: victim@example.com" }).success).toBe(false);
  });

  it("accepts only inspected authenticated Sendloom CTA routes", () => {
    expect(normalizeProductUpdateCtaHref("/account")).toBe("/account");
    expect(normalizeProductUpdateCtaHref("/prospects/search-1?tab=people#top")).toBe("/prospects/search-1?tab=people#top");
    expect(normalizeProductUpdateCtaHref("/sequences/new")).toBe("/sequences/new");
    for (const unsafe of [
      "https://evil.example",
      "http://evil.example",
      "//evil.example/path",
      "/%2f%2fevil.example",
      "/workspace%3Fnext=https%3A%2F%2Fevil.example",
      "/unknown-route",
      "javascript:alert(1)",
      "data:text/html,bad",
      "/\\evil.example"
    ]) {
      expect(normalizeProductUpdateCtaHref(unsafe)).toBeNull();
    }
  });

  it("requires CTA label and destination together", () => {
    expect(productUpdateBroadcastInputSchema.safeParse({
      ...input(),
      features: [{ ...feature(), ctaHref: null }]
    }).success).toBe(false);
    expect(productUpdateBroadcastInputSchema.safeParse({
      ...input(),
      features: [{ ...feature(), ctaLabel: null }]
    }).success).toBe(false);
  });

  it("normalizes IANA timezones and protects send-now with the exact typed phrase", () => {
    expect(productUpdateBroadcastInputSchema.parse({ ...input(), timeZone: "US/Arizona" }).timeZone).toBe("America/Phoenix");
    expect(productUpdateBroadcastInputSchema.safeParse({ ...input(), timeZone: "+07:00" }).success).toBe(false);
    expect(sendNowProductUpdateBroadcastSchema.parse({ confirmation: PRODUCT_UPDATE_CONFIRMATION_PHRASE })).toEqual({
      confirmation: "SEND TO ALL USERS"
    });
    expect(sendNowProductUpdateBroadcastSchema.safeParse({ confirmation: "send" }).success).toBe(false);
  });
});
