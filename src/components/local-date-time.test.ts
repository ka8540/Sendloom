import { describe, expect, it } from "vitest";

import { formatDateTimeForTimeZone } from "@/components/local-date-time";

describe("formatDateTimeForTimeZone", () => {
  it("formats a deterministic hydration-safe UTC value", () => {
    expect(formatDateTimeForTimeZone("2026-05-26T20:30:00.000Z", "Not available", "dateTime", "UTC")).toBe(
      "May 26, 2026, 8:30 PM UTC"
    );
  });

  it("formats the same timestamp for a browser timezone after hydration", () => {
    expect(formatDateTimeForTimeZone("2026-05-26T20:30:00.000Z", "Not available", "time", "America/Phoenix")).toBe(
      "1:30 PM MST"
    );
  });

  it("uses the empty label for missing or invalid values", () => {
    expect(formatDateTimeForTimeZone(null, "Never", "dateTime", "UTC")).toBe("Never");
    expect(formatDateTimeForTimeZone("not-a-date", "Never", "dateTime", "UTC")).toBe("Never");
  });
});
