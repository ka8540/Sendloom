import { describe, expect, it } from "vitest";

import { canUseBrowserBack, getDefaultBackFallback } from "@/lib/back-navigation";

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

describe("canUseBrowserBack", () => {
  const currentOrigin = "https://sendloom.test";

  it("allows browser back for app-to-app navigation", () => {
    expect(
      canUseBrowserBack({
        currentOrigin,
        currentPathname: "/campaigns/abc123",
        historyLength: 3,
        referrer: "https://sendloom.test/campaigns"
      })
    ).toBe(true);
  });

  it("blocks browser back when an app page was opened from public auth pages", () => {
    expect(
      canUseBrowserBack({
        currentOrigin,
        currentPathname: "/campaigns/abc123",
        historyLength: 3,
        referrer: "https://sendloom.test/login"
      })
    ).toBe(false);
  });

  it("blocks browser back when the referrer is outside the app or site", () => {
    expect(
      canUseBrowserBack({
        currentOrigin,
        currentPathname: "/workspace",
        historyLength: 2,
        referrer: "https://example.com/"
      })
    ).toBe(false);
  });

  it("still allows public pages to use same-origin browser history", () => {
    expect(
      canUseBrowserBack({
        currentOrigin,
        currentPathname: "/login",
        historyLength: 2,
        referrer: "https://sendloom.test/signup"
      })
    ).toBe(true);
  });
});
