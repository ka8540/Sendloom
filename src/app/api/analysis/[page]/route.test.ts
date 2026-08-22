import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ROUTE = readFileSync("src/app/api/analysis/[page]/route.ts", "utf8");
const SERVICE = readFileSync("src/services/analysis.ts", "utf8");
const WORKSPACE = readFileSync("src/components/analysis/analysis-workspace.tsx", "utf8");

describe("Analysis API authorization and scoping", () => {
  it("requires a verified authenticated API user before aggregation", () => {
    expect(ROUTE).toContain("await requireApiUser()");
    expect(ROUTE.indexOf("await requireApiUser()")).toBeLessThan(ROUTE.indexOf("const data = await getAnalysisPageData"));
  });

  it("passes only the authenticated user id into the aggregation service", () => {
    expect(ROUTE).toContain("userId: auth.user.id");
    expect(ROUTE).not.toContain('searchParams.get("userId")');
  });

  it("validates the timezone parameter and uses it to normalize the Analysis range", () => {
    expect(ROUTE).toContain('normalizeAnalysisTimeZone(url.searchParams.get("timezone"))');
    expect(ROUTE).toContain("new Date(),\n    timeZone");
    expect(WORKSPACE).toContain("detectBrowserAnalysisTimeZone()");
    expect(WORKSPACE).toContain("if (!timeZone || !range) return;");
    expect(WORKSPACE).toContain("&timezone=${encodeURIComponent(timeZone)}");
  });

  it("prevents timezone-specific Analysis aggregates from being cached across requests", () => {
    expect(ROUTE).toContain('"Cache-Control": "private, no-store"');
    expect(WORKSPACE).toContain('cache: "no-store"');
  });

  it("uses timezone-aware helpers for trends, best days, heatmaps, and operational events", () => {
    expect(SERVICE).toContain("instantToAnalysisDateKey(activity.sentAt, period.timeZone)");
    expect(SERVICE).toContain("instantToAnalysisDateKey(activity.openedAt, period.timeZone)");
    expect(SERVICE).toContain("instantToAnalysisDateKey(activity.clickedAt, period.timeZone)");
    expect(SERVICE).toContain("instantToAnalysisDateKey(activity.repliedAt, period.timeZone)");
    expect(SERVICE).toContain("analysisLocalWeekdayHour(activity.sentAt, timeZone).weekdayIndex");
    expect(SERVICE).toContain("analysisHeatmapBucket(activity.sentAt, timeZone)");
    expect(SERVICE).toContain("instantToAnalysisDateKey(event.createdAt, period.timeZone)");
  });

  it("scopes SendLedger, campaign, sender, reply, and job reads to user ownership", () => {
    expect(SERVICE).toContain("where: { userId, sentAt:");
    expect(SERVICE).toContain("campaignRun: { campaign: { userId } }");
    expect(SERVICE).toContain("senderProfile: { userId }");
    expect(SERVICE).toContain("where: { userId }");
  });

  it("does not expose sender credentials in the sender response", () => {
    expect(SERVICE).toContain("connected: Boolean(oauthRefreshToken)");
    expect(SERVICE).not.toContain("oauthRefreshToken: sender.oauthRefreshToken");
  });

  it("builds exports from the already authenticated current-page response", () => {
    expect(WORKSPACE).toContain("buildAnalysisCsv(data)");
    expect(WORKSPACE).toContain("sendloom-analysis-${data.page}-${data.range.from}-to-${data.range.to}.csv");
    expect(WORKSPACE).not.toContain('searchParams.get("userId")');
  });
});
