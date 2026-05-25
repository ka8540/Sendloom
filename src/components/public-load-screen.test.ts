import { describe, expect, it } from "vitest";

import { LOAD_SCREEN_COOLDOWN_MS, shouldShowLoadScreen } from "@/components/public-load-screen";

describe("shouldShowLoadScreen", () => {
  it("shows when no prior load screen timestamp exists", () => {
    expect(shouldShowLoadScreen(null, 1_000)).toBe(true);
  });

  it("hides when the load screen was shown within the cooldown", () => {
    expect(shouldShowLoadScreen("1000", 1_000 + LOAD_SCREEN_COOLDOWN_MS - 1)).toBe(false);
  });

  it("shows again after the cooldown expires", () => {
    expect(shouldShowLoadScreen("1000", 1_000 + LOAD_SCREEN_COOLDOWN_MS)).toBe(true);
  });

  it("shows when a stored timestamp is invalid", () => {
    expect(shouldShowLoadScreen("not-a-time", 1_000)).toBe(true);
  });
});
