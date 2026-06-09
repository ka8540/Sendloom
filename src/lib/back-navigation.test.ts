import { describe, expect, it } from "vitest";

import { getDefaultBackFallback, shouldUseBrowserBack } from "@/lib/back-navigation";

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
