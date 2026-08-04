import { describe, expect, it } from "vitest";

import {
  ANALYSIS_MIN_RANKING_SENDS,
  buildCountComparison,
  buildRateComparison,
  calculateRate,
  classifyAnalysisFailure,
  countUniqueConfirmedSends,
  countUniqueMatchedReplies,
  meetsAnalysisRankingMinimum,
  normalizeAnalysisDateRange,
  normalizeAnalysisScheduleType
} from "@/lib/analysis";

describe("Analysis date ranges", () => {
  it("normalizes an inclusive UTC range and creates an equal prior period", () => {
    const range = normalizeAnalysisDateRange(
      { from: "2026-07-10", to: "2026-07-16" },
      new Date("2026-08-04T17:00:00.000Z")
    );

    expect(range.days).toBe(7);
    expect(range.start.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-07-17T00:00:00.000Z");
    expect(range.previousStart.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(range.previousEndExclusive.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("falls back to seven days for reversed or overlong custom ranges", () => {
    const reversed = normalizeAnalysisDateRange(
      { from: "2026-08-04", to: "2026-07-01" },
      new Date("2026-08-04T17:00:00.000Z")
    );
    const overlong = normalizeAnalysisDateRange(
      { from: "2024-01-01", to: "2026-08-04" },
      new Date("2026-08-04T17:00:00.000Z")
    );

    expect(reversed.days).toBe(7);
    expect(overlong.days).toBe(7);
    expect(reversed.from).toBe("2026-07-29");
    expect(overlong.to).toBe("2026-08-04");
  });
});

describe("Analysis metric formulas", () => {
  it("uses zero for zero denominators", () => {
    expect(calculateRate(4, 0)).toBe(0);
    expect(calculateRate(1, 3)).toBe(33.3);
  });

  it("does not emit infinite prior-period comparisons", () => {
    expect(buildCountComparison(10, 0)).toEqual({ label: "New activity", direction: "up" });
    expect(buildCountComparison(0, 0)).toEqual({ label: "No prior data", direction: "neutral" });
    expect(buildRateComparison(12.8, 10)).toEqual({ label: "+2.8 pp vs prior period", direction: "up" });
  });

  it("deduplicates confirmed sends by recipient job and keeps ledger-only sends distinct", () => {
    expect(
      countUniqueConfirmedSends([
        { id: "ledger-1", recipientJobId: "job-1" },
        { id: "ledger-2", recipientJobId: "job-1" },
        { id: "ledger-3", recipientJobId: "job-2" },
        { id: "ledger-4", recipientJobId: null },
        { id: "ledger-5", recipientJobId: null }
      ])
    ).toBe(4);
  });

  it("counts unique matched reply recipients only from the confirmed-send cohort", () => {
    expect(
      countUniqueMatchedReplies(["job-1", "job-2"], [
        { recipientJobId: "job-1" },
        { recipientJobId: "job-1" },
        { recipientJobId: "job-3" },
        { recipientJobId: null }
      ])
    ).toBe(1);
  });

  it("requires the minimum confirmed-send sample for rankings", () => {
    expect(meetsAnalysisRankingMinimum(ANALYSIS_MIN_RANKING_SENDS - 1)).toBe(false);
    expect(meetsAnalysisRankingMinimum(ANALYSIS_MIN_RANKING_SENDS)).toBe(true);
  });
});

describe("Analysis classification", () => {
  it("normalizes legacy or missing schedule values to immediate", () => {
    expect(normalizeAnalysisScheduleType(null)).toBe("immediate");
    expect(normalizeAnalysisScheduleType("legacy")).toBe("immediate");
    expect(normalizeAnalysisScheduleType("Once")).toBe("once");
    expect(normalizeAnalysisScheduleType("recurring")).toBe("recurring");
  });

  it("excludes per-minute pacing and daily-cap waits from permanent failures", () => {
    expect(
      classifyAnalysisFailure({ status: "PENDING", metadata: { blockedBy: "GMAIL_SENDER_PACING" } })
    ).toEqual({ category: "Rate limited", disposition: "pacing" });
    expect(
      classifyAnalysisFailure({ status: "PENDING", metadata: { blockedBy: "DAILY_SEND_LIMIT" } })
    ).toEqual({ category: "Rate limited", disposition: "pacing" });
  });

  it("keeps suppressions separate and classifies retryable diagnostics", () => {
    expect(classifyAnalysisFailure({ status: "SUPPRESSED" })).toEqual({
      category: "Suppressed",
      disposition: "suppressed"
    });
    expect(
      classifyAnalysisFailure({ status: "RETRYING", metadata: { failureCode: "GMAIL_TEMPORARY_FAILURE" } })
    ).toEqual({ category: "Gmail temporary failure", disposition: "retryable" });
  });
});
