import { describe, expect, it } from "vitest";

import {
  DiscoverCandidateEligibilityService,
  emptyCandidateJudgeDiagnostics,
  type DiscoverCandidateDecision,
  type DiscoverCandidateEligibilityPort
} from "./discover-candidate-eligibility-service";
import { AiCallBudget } from "./prospect-ai";
import { emptyPublicProfileDiagnostics, judgePublicProfileSearchResults } from "./public-profile-search-metadata";

function budget() {
  return new AiCallBudget({ company_resolution: 0, role_classification: 0,
    candidate_eligibility: 2, email_pattern: 0, person_identity: 0 });
}

function row(id: string, title: string, description: string, url = `https://www.linkedin.com/in/${id}`) {
  return { url, title: `Person ${id} - ${title} | LinkedIn`, description };
}

function decision(candidateId: string, value: "ACCEPT" | "REJECT" | "UNCERTAIN"): DiscoverCandidateDecision {
  return {
    candidateId,
    decision: value,
    companyMatch: value === "ACCEPT",
    roleMatch: value === "ACCEPT",
    locationMatch: value === "ACCEPT",
    currentEmployment: value === "ACCEPT",
    confidence: value === "UNCERTAIN" ? "LOW" : "HIGH",
    reasonCode: value === "ACCEPT" ? "MATCH" : value === "UNCERTAIN" ? "INSUFFICIENT_EVIDENCE" : "ROLE_MISMATCH",
    matchedRequestedRoles: value === "ACCEPT" ? ["Recruiter"] : []
  };
}

function judge(values: Record<string, "ACCEPT" | "REJECT" | "UNCERTAIN">, shadow = false): DiscoverCandidateEligibilityPort {
  return {
    enabled: true,
    shadow,
    evaluate: async ({ candidates }) => ({
      shadow,
      decisions: new Map(candidates.flatMap((candidate) => {
        const value = values[candidate.candidateId];
        return value ? [[candidate.candidateId, decision(candidate.candidateId, value)] as const] : [];
      })),
      diagnostics: {
        ...emptyCandidateJudgeDiagnostics(),
        aiJudgeCandidateCount: candidates.length,
        aiJudgeAcceptedCount: Object.values(values).filter((value) => value === "ACCEPT").length,
        aiJudgeRejectedCount: Object.values(values).filter((value) => value === "REJECT").length,
        aiJudgeUncertainCount: Object.values(values).filter((value) => value === "UNCERTAIN").length
      }
    })
  };
}

const input = {
  companyName: "Guidewire Software",
  requestedTitles: ["Recruiter"],
  locations: ["United States"],
  provider: "FIRECRAWL" as const,
  budget: budget()
};

describe("public profile candidate judge authority", () => {
  it("applies Guidewire role, company, employment, and location decisions and falls back for UNCERTAIN", async () => {
    const rows = [
      row("talent-partner", "Senior Talent Acquisition Partner at Guidewire Software", "Senior Talent Acquisition Partner · Guidewire Software · San Mateo, California, United States"),
      row("technical-recruiter", "Technical Recruiter at Guidewire Software", "Technical Recruiter · Guidewire Software · United States"),
      row("talent-sourcer", "Talent Sourcer at Guidewire Software", "Talent Sourcer · Guidewire Software · United States"),
      row("recruitment-partner", "Recruitment Partner at Guidewire Software", "Recruitment Partner · Guidewire Software · United States"),
      row("recruiting-manager", "Recruiting Manager at Guidewire Software", "Recruiting Manager · Guidewire Software · United States"),
      row("software-engineer", "Software Engineer at Guidewire Software", "Software Engineer · Guidewire Software · United States"),
      row("product-manager", "Product Manager at Guidewire Software", "Product Manager · Guidewire Software · United States"),
      row("marketing-manager", "Marketing Manager at Guidewire Software", "Marketing Manager · Guidewire Software · United States"),
      row("hr-generalist", "HR Generalist at Guidewire Software", "HR Generalist · Guidewire Software · United States"),
      row("former", "Former Technical Recruiter at Guidewire Software", "Former Technical Recruiter · Guidewire Software · United States"),
      row("microsoft", "Recruiter at Microsoft", "Recruiter · Microsoft · United States"),
      row("london", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software · London, United Kingdom"),
      row("unknown", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software")
    ];
    const accepted = new Set([0, 1, 2, 3, 4]);
    const values = Object.fromEntries(rows.map((_entry, index) => [
      `FIRECRAWL:${index}`,
      accepted.has(index) ? "ACCEPT" : index === 12 ? "UNCERTAIN" : "REJECT"
    ])) as Record<string, "ACCEPT" | "REJECT" | "UNCERTAIN">;
    const diagnostics = emptyPublicProfileDiagnostics();

    const profiles = await judgePublicProfileSearchResults(rows, input, diagnostics, judge(values));

    expect(profiles.map((profile) => profile.sourceProfileId)).toEqual([
      "talent-partner", "technical-recruiter", "talent-sourcer", "recruitment-partner", "recruiting-manager",
      // UNCERTAIN delegates to the unchanged country-level deterministic fallback.
      "unknown"
    ]);
    expect(diagnostics).toMatchObject({
      aiJudgeCandidateCount: 13,
      aiJudgeAcceptedCount: 5,
      aiJudgeRejectedCount: 7,
      aiJudgeUncertainCount: 1
    });
  });

  it("lets AI ACCEPT rescue a deterministic company or role rejection", async () => {
    const diagnostics = emptyPublicProfileDiagnostics();
    const profiles = await judgePublicProfileSearchResults([
      row("unusual", "People Scout at OtherCo", "People Scout · OtherCo · United States")
    ], input, diagnostics, judge({ "FIRECRAWL:0": "ACCEPT" }));

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ sourceProfileId: "unusual", discoverEligibility: "AI_ACCEPT" });
    expect(diagnostics.aiAcceptedDeterministicWouldRejectCount).toBe(1);
  });

  it("lets AI REJECT override a deterministic acceptance", async () => {
    const diagnostics = emptyPublicProfileDiagnostics();
    const profiles = await judgePublicProfileSearchResults([
      row("old-accept", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software · United States")
    ], input, diagnostics, judge({ "FIRECRAWL:0": "REJECT" }));

    expect(profiles).toEqual([]);
    expect(diagnostics.aiRejectedDeterministicWouldAcceptCount).toBe(1);
  });

  it("uses the old deterministic decision for UNCERTAIN and missing AI output", async () => {
    const rows = [
      row("uncertain-valid", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software · United States"),
      row("missing-invalid", "Recruiter at OtherCo", "Recruiter · OtherCo · United States")
    ];
    const profiles = await judgePublicProfileSearchResults(
      rows, input, emptyPublicProfileDiagnostics(), judge({ "FIRECRAWL:0": "UNCERTAIN" })
    );
    expect(profiles.map((profile) => profile.sourceProfileId)).toEqual(["uncertain-valid"]);
    expect(profiles[0]?.discoverEligibility).toBe("DETERMINISTIC_FALLBACK");
  });

  it("uses the old deterministic pipeline for the full batch when the AI call fails", async () => {
    const service = new DiscoverCandidateEligibilityService({
      enabled: true,
      model: "test-model",
      complete: async () => { throw new Error("timeout"); }
    }, { enabled: true });
    const diagnostics = emptyPublicProfileDiagnostics();
    const profiles = await judgePublicProfileSearchResults([
      row("valid-fallback", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software · United States"),
      row("invalid-fallback", "Recruiter at OtherCo", "Recruiter · OtherCo · United States")
    ], input, diagnostics, service);

    expect(profiles.map((profile) => profile.sourceProfileId)).toEqual(["valid-fallback"]);
    expect(diagnostics.aiJudgeFallbackCount).toBe(2);
  });

  it("does not persist an AI-accepted row without a valid LinkedIn person identity", async () => {
    const diagnostics = emptyPublicProfileDiagnostics();
    const profiles = await judgePublicProfileSearchResults([
      row("bad", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software · United States", "https://linkedin.com/company/guidewire")
    ], input, diagnostics, judge({ "FIRECRAWL:0": "ACCEPT" }));

    expect(profiles).toEqual([]);
    expect(diagnostics.aiAcceptedButUnpersistableCount).toBe(1);
  });

  it("runs AI in shadow mode while keeping deterministic acceptance authoritative", async () => {
    const diagnostics = emptyPublicProfileDiagnostics();
    const profiles = await judgePublicProfileSearchResults([
      row("valid", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software · United States"),
      row("invalid", "Recruiter at OtherCo", "Recruiter · OtherCo · United States")
    ], input, diagnostics, judge({ "FIRECRAWL:0": "REJECT", "FIRECRAWL:1": "ACCEPT" }, true));

    expect(profiles.map((profile) => profile.sourceProfileId)).toEqual(["valid"]);
    expect(diagnostics.aiRejectedDeterministicWouldAcceptCount).toBe(1);
    expect(diagnostics.aiAcceptedDeterministicWouldRejectCount).toBe(1);
  });

  it("preserves the old deterministic path when the feature flag is disabled", async () => {
    const disabled: DiscoverCandidateEligibilityPort = {
      enabled: false,
      shadow: false,
      evaluate: async () => { throw new Error("must not run"); }
    };
    const profiles = await judgePublicProfileSearchResults([
      row("flag-valid", "Recruiter at Guidewire Software", "Recruiter · Guidewire Software · United States"),
      row("flag-invalid", "Recruiter at OtherCo", "Recruiter · OtherCo · United States")
    ], input, emptyPublicProfileDiagnostics(), disabled);

    expect(profiles.map((profile) => profile.sourceProfileId)).toEqual(["flag-valid"]);
  });
});
