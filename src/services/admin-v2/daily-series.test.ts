import { describe, expect, it } from "vitest";
import { buildUtcSeries } from "./daily-series";
import { normalizeAdminPage } from "./pagination";

describe("Admin daily series and pagination", () => {
  it("fills missing UTC days for chart ranges", () => {
    const rows = buildUtcSeries(
      3,
      {
        sends: [{ day: new Date("2026-10-01T00:00:00Z"), count: 7 }],
        searches: [],
      },
      new Date("2026-10-02T10:00:00Z"),
    );
    expect(rows).toEqual([
      { day: "2026-09-30", sends: 0, searches: 0 },
      { day: "2026-10-01", sends: 7, searches: 0 },
      { day: "2026-10-02", sends: 0, searches: 0 },
    ]);
  });
  it("supports first, middle, final, empty, and out-of-range pages", () => {
    expect(normalizeAdminPage(1, 51, 20)).toBe(1);
    expect(normalizeAdminPage(2, 51, 20)).toBe(2);
    expect(normalizeAdminPage(3, 51, 20)).toBe(3);
    expect(normalizeAdminPage(10, 51, 20)).toBe(3);
    expect(normalizeAdminPage(-2, 0, 20)).toBe(1);
  });
});
