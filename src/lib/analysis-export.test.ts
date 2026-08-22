import { describe, expect, it } from "vitest";

import { buildAnalysisCsv } from "@/lib/analysis-export";
import type { AnalysisOverviewResponse } from "@/lib/analysis-types";

function overviewResponse(): AnalysisOverviewResponse {
  return {
    page: "overview",
    range: {
      from: "2026-03-23",
      to: "2026-03-29",
      label: "Mar 23 – Mar 29, 2026",
      days: 7,
      timeZone: "America/Phoenix"
    },
    generatedAt: "2026-03-30T00:00:00.000Z",
    hasData: false,
    metrics: [
      {
        key: "sent",
        label: "Sent",
        value: 0,
        format: "number",
        detail: "Confirmed Gmail sends",
        info: "Confirmed sends only.",
        tone: "green",
        icon: "send"
      }
    ],
    trends: [
      {
        date: "2026-03-23",
        label: "Mon",
        sent: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        openRate: 0,
        clickRate: 0,
        replyRate: 0
      }
    ],
    outcomeMix: [],
    journey: [],
    bestDays: [],
    topMovers: []
  };
}

describe("Analysis CSV export", () => {
  it("exports only the supplied current-page aggregate with its local range and timezone", () => {
    const csv = buildAnalysisCsv(overviewResponse());

    expect(csv).toContain("Sendloom Analysis,overview");
    expect(csv).toContain("Local date range,2026-03-23 to 2026-03-29");
    expect(csv).toContain("Timezone,America/Phoenix");
    expect(csv).toContain("Sent,0,Confirmed Gmail sends");
    expect(csv).toContain("2026-03-23,0,0,0,0,0%,0%,0%");
    expect(csv).not.toContain("userId");
    expect(csv).not.toContain("oauthRefreshToken");
    expect(csv).not.toContain("another user's data");
  });

  it("keeps a no-data export finite and explicit instead of inventing values", () => {
    const csv = buildAnalysisCsv(overviewResponse());

    expect(csv).not.toContain("Infinity");
    expect(csv).not.toContain("NaN");
    expect(csv).not.toContain("undefined");
  });

  it("escapes commas and quotes in exported labels", () => {
    const response = overviewResponse();
    response.metrics[0].detail = 'Confirmed, Gmail "send"';

    expect(buildAnalysisCsv(response)).toContain('"Confirmed, Gmail ""send"""');
  });
});
