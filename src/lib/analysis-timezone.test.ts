import { describe, expect, it } from "vitest";

import {
  analysisHeatmapBucket,
  analysisLocalDateStartUtc,
  analysisLocalWeekdayHour,
  instantToAnalysisDateKey,
  normalizeAnalysisTimeZone
} from "@/lib/analysis-timezone";

describe("Analysis IANA timezone attribution", () => {
  it("puts a UTC Saturday instant on Friday in America/Phoenix", () => {
    const instant = new Date("2026-08-22T01:00:00.000Z");

    expect(instantToAnalysisDateKey(instant, "America/Phoenix")).toBe("2026-08-21");
    expect(analysisLocalWeekdayHour(instant, "America/Phoenix")).toEqual({
      weekdayIndex: 5,
      hour: 18
    });
  });

  it("uses the correct previous local day around midnight in America/New_York", () => {
    const instant = new Date("2026-08-22T03:30:00.000Z");

    expect(instantToAnalysisDateKey(instant, "America/New_York")).toBe("2026-08-21");
    expect(analysisLocalWeekdayHour(instant, "America/New_York")).toEqual({
      weekdayIndex: 5,
      hour: 23
    });
  });

  it("supports positive half-hour offsets such as Asia/Kolkata", () => {
    const instant = new Date("2026-08-21T20:00:00.000Z");

    expect(instantToAnalysisDateKey(instant, "Asia/Kolkata")).toBe("2026-08-22");
    expect(analysisLocalWeekdayHour(instant, "Asia/Kolkata")).toEqual({
      weekdayIndex: 6,
      hour: 1
    });
  });

  it("keeps UTC attribution equivalent to the stored instant", () => {
    const instant = new Date("2026-08-22T01:00:00.000Z");

    expect(instantToAnalysisDateKey(instant, "UTC")).toBe("2026-08-22");
    expect(analysisLocalWeekdayHour(instant, "UTC")).toEqual({ weekdayIndex: 6, hour: 1 });
  });

  it("falls back safely for missing or invalid timezone input", () => {
    expect(normalizeAnalysisTimeZone(undefined)).toBe("UTC");
    expect(normalizeAnalysisTimeZone("Not/A_Real_Zone")).toBe("UTC");
    expect(normalizeAnalysisTimeZone("+07:00")).toBe("UTC");
  });

  it("attributes best-day sends by local weekday, not UTC weekday", () => {
    const fridayLocalSaturdayUtc = new Date("2026-08-22T01:00:00.000Z");

    expect(analysisLocalWeekdayHour(fridayLocalSaturdayUtc, "America/Phoenix").weekdayIndex).toBe(5);
  });

  it("puts a previous-local-day evening event into the 8p–12a heatmap block", () => {
    const event = new Date("2026-08-22T03:00:00.000Z");

    expect(analysisHeatmapBucket(event, "America/Phoenix")).toEqual({
      weekdayIndex: 5,
      blockIndex: 5
    });
  });
});

describe("Analysis local calendar boundaries", () => {
  it("uses a 23-hour local day across New York spring-forward", () => {
    const start = analysisLocalDateStartUtc("2026-03-08", "America/New_York");
    const end = analysisLocalDateStartUtc("2026-03-09", "America/New_York");

    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("uses a 25-hour local day across New York fall-back", () => {
    const start = analysisLocalDateStartUtc("2026-11-01", "America/New_York");
    const end = analysisLocalDateStartUtc("2026-11-02", "America/New_York");

    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});
