import { describe, expect, it, vi } from "vitest";

import {
  DiscoverCandidateEligibilityService,
  type DiscoverCandidateEvidence
} from "./discover-candidate-eligibility-service";
import { AiCallBudget, type AiClient } from "./prospect-ai";

function budget(calls = 10) {
  return new AiCallBudget({
    company_resolution: 0,
    role_classification: 0,
    candidate_eligibility: calls,
    email_pattern: 0,
    person_identity: 0
  });
}

function candidate(index: number): DiscoverCandidateEvidence {
  return {
    candidateId: `FIRECRAWL:${index}`,
    provider: "FIRECRAWL",
    name: `Person ${index}`,
    url: `https://www.linkedin.com/in/person-${index}`,
    providerTitle: `Person ${index} - Recruiter at Guidewire Software`,
    providerDescription: "Recruiter · Guidewire Software · United States",
    parsedTitle: "Recruiter",
    parsedCompany: "Guidewire Software",
    parsedLocation: "United States",
    employmentParserDecision: "CURRENT",
    locationParserDecision: "MATCH",
    roleClassifierCategory: "RECRUITING"
  };
}

function accepted(candidateId: string) {
  return {
    candidateId,
    decision: "ACCEPT" as const,
    companyMatch: true,
    roleMatch: true,
    locationMatch: true,
    currentEmployment: true,
    confidence: "HIGH" as const,
    reasonCode: "MATCH" as const,
    matchedRequestedRoles: ["Recruiter"]
  };
}

function ai(complete: AiClient["complete"]): AiClient {
  return { enabled: true, model: "test-model", complete };
}

const intent = { company: "Guidewire Software", roles: ["Recruiter"], locations: ["United States"] };

describe("DiscoverCandidateEligibilityService", () => {
  it("batches 51 candidates as 25, 25, and 1 while deciding every candidate", async () => {
    const calls: number[] = [];
    const complete = vi.fn(async (request) => {
      const payload = JSON.parse(request.input) as { candidates: DiscoverCandidateEvidence[] };
      calls.push(payload.candidates.length);
      return { decisions: payload.candidates.map((entry) => accepted(entry.candidateId)) };
    });
    const service = new DiscoverCandidateEligibilityService(ai(complete), {
      enabled: true,
      batchSize: 25
    });

    const result = await service.evaluate({
      intent,
      candidates: Array.from({ length: 51 }, (_, index) => candidate(index)),
      budget: budget(3)
    });

    expect(calls).toEqual([25, 25, 1]);
    expect(result.decisions.size).toBe(51);
    expect(result.diagnostics).toMatchObject({
      aiJudgeCandidateCount: 51,
      aiJudgeAcceptedCount: 51,
      aiJudgeFallbackCount: 0,
      aiJudgeMissingDecisionCount: 0
    });
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("uses fallback for a missing, duplicate, or wrong decision ID without accepting it", async () => {
    const service = new DiscoverCandidateEligibilityService(ai(async () => ({ decisions: [
      accepted("FIRECRAWL:0"),
      accepted("FIRECRAWL:0"),
      accepted("WRONG:1")
    ] })), { enabled: true, batchSize: 25 });

    const result = await service.evaluate({
      intent,
      candidates: [candidate(0), candidate(1)],
      budget: budget()
    });

    expect(result.decisions.size).toBe(0);
    expect(result.diagnostics.aiJudgeMissingDecisionCount).toBe(2);
    expect(result.diagnostics.aiJudgeFallbackCount).toBe(2);
  });

  it.each([
    ["AI error", async () => { throw new Error("timeout"); }],
    ["malformed output", async () => ({ decisions: [{ candidateId: "FIRECRAWL:0" }] })]
  ])("falls back safely for %s", async (_label, complete) => {
    const service = new DiscoverCandidateEligibilityService(ai(complete), { enabled: true });
    const result = await service.evaluate({ intent, candidates: [candidate(0)], budget: budget() });
    expect(result.decisions.size).toBe(0);
    expect(result.diagnostics.aiJudgeFallbackCount).toBe(1);
    expect(result.diagnostics.aiJudgeAcceptedCount).toBe(0);
  });

  it("falls back when AI or its per-search budget is disabled", async () => {
    const complete = vi.fn(async () => ({ decisions: [accepted("FIRECRAWL:0")] }));
    const disabledAi = new DiscoverCandidateEligibilityService(
      { enabled: false, model: "test-model", complete },
      { enabled: true }
    );
    const noBudget = new DiscoverCandidateEligibilityService(ai(complete), { enabled: true });

    const [disabledResult, budgetResult] = await Promise.all([
      disabledAi.evaluate({ intent, candidates: [candidate(0)], budget: budget() }),
      noBudget.evaluate({ intent, candidates: [candidate(0)], budget: budget(0) })
    ]);

    expect(disabledResult.diagnostics.aiJudgeFallbackCount).toBe(1);
    expect(budgetResult.diagnostics.aiJudgeFallbackCount).toBe(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it("marks UNCERTAIN as a deterministic fallback candidate", async () => {
    const service = new DiscoverCandidateEligibilityService(ai(async () => ({ decisions: [{
      ...accepted("FIRECRAWL:0"),
      decision: "UNCERTAIN",
      companyMatch: false,
      roleMatch: false,
      locationMatch: false,
      currentEmployment: false,
      confidence: "LOW",
      reasonCode: "INSUFFICIENT_EVIDENCE",
      matchedRequestedRoles: []
    }] })), { enabled: true });

    const result = await service.evaluate({ intent, candidates: [candidate(0)], budget: budget() });

    expect(result.decisions.get("FIRECRAWL:0")?.decision).toBe("UNCERTAIN");
    expect(result.diagnostics).toMatchObject({ aiJudgeUncertainCount: 1, aiJudgeFallbackCount: 1 });
  });
});
