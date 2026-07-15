import { describe, expect, it } from "vitest";

import {
  getDefaultBackFallback,
  getSequenceDetailReturnTo,
  shouldUseBrowserBack
} from "@/lib/back-navigation";

describe("getDefaultBackFallback", () => {
  it("sends app routes back to overview by default", () => {
    expect(getDefaultBackFallback("/campaigns/abc123")).toBe("/workspace");
    expect(getDefaultBackFallback("/imports")).toBe("/workspace");
  });

  it("keeps admin routes inside admin", () => {
    expect(getDefaultBackFallback("/admin")).toBe("/admin");
    expect(getDefaultBackFallback("/admin/users")).toBe("/admin");
  });

  it("sends public routes back home", () => {
    expect(getDefaultBackFallback("/login")).toBe("/");
    expect(getDefaultBackFallback("/privacy")).toBe("/");
  });
});

describe("shouldUseBrowserBack", () => {
  it("uses browser history once the user has navigated within the app", () => {
    expect(shouldUseBrowserBack({ navigationDepth: 1 })).toBe(true);
    expect(shouldUseBrowserBack({ navigationDepth: 3 })).toBe(true);
  });

  it("falls back when the page was opened directly (no in-app history)", () => {
    expect(shouldUseBrowserBack({ navigationDepth: 0 })).toBe(false);
  });

  it("always falls back when the caller forces it", () => {
    expect(shouldUseBrowserBack({ alwaysUseFallback: true, navigationDepth: 5 })).toBe(false);
  });
});

describe("getSequenceDetailReturnTo", () => {
  it("restores a filtered Sequences dashboard URL from a detail page", () => {
    const params = new URLSearchParams({
      returnTo:
        "/campaigns?status=needs-attention&page=4&q=amd&sender=kush.ahir2024%40gmail.com"
    });

    expect(getSequenceDetailReturnTo("/campaigns/seq-1", params)).toBe(
      "/campaigns?status=needs-attention&page=4&q=amd&sender=kush.ahir2024%40gmail.com"
    );
  });

  it("accepts the /sequences alias but rejects non-dashboard and external targets", () => {
    expect(
      getSequenceDetailReturnTo(
        "/sequences/seq-1",
        new URLSearchParams({ returnTo: "/sequences?status=paused&page=2" })
      )
    ).toBe("/sequences?status=paused&page=2");
    expect(
      getSequenceDetailReturnTo(
        "/campaigns/seq-1",
        new URLSearchParams({ returnTo: "/workspace" })
      )
    ).toBeNull();
    expect(
      getSequenceDetailReturnTo(
        "/campaigns/seq-1",
        new URLSearchParams({ returnTo: "https://example.com/campaigns" })
      )
    ).toBeNull();
  });

  it("ignores returnTo outside sequence-detail routes", () => {
    expect(
      getSequenceDetailReturnTo(
        "/campaigns",
        new URLSearchParams({ returnTo: "/campaigns?status=completed" })
      )
    ).toBeNull();
  });
});
