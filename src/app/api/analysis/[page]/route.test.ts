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
