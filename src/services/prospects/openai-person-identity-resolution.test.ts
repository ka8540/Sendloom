import { describe, expect, it, vi } from "vitest";

process.env.OPENAI_API_KEY = "sk-test";
process.env.PROSPECT_AI_ENABLED = "true";
process.env.PROSPECT_AI_MODEL = "";
process.env.PROSPECT_IDENTITY_RESOLUTION_ENABLED = "true";

import {
  OPENAI_PERSON_IDENTITY_INSTRUCTIONS,
  OpenAIPersonIdentityResolver,
  type IdentitySearchRequest,
  type PersonIdentityResolutionInput,
  type PersonIdentitySearchCaller,
  acceptResolution,
  buildIdentityResolutionInput,
  resolveIncompleteIdentities
} from "@/services/prospects/openai-person-identity-resolution";
import { createAiBudget, AiCallBudget } from "@/services/prospects/prospect-ai";

const INPUT: PersonIdentityResolutionInput = {
  displayName: "Jared C.",
  knownFirstName: "Jared",
  knownFirstInitial: "j",
  companyName: "Apple",
  companyDomain: "apple.com",
  currentTitle: "Software Engineer",
  location: "Cupertino, California, United States",
  linkedinUrl: "https://www.linkedin.com/in/jared-c-1"
};

const HIGH_CONFIDENCE_ANSWER = {
  resolvedFirstName: "Jared",
  resolvedLastName: "Cho",
  confidence: "HIGH",
  identityMatched: true,
  companyMatched: true,
  sources: ["https://example.com/team/jared-cho"],
  reason: "Public team page lists this engineer at the same employer."
};

/** Records every request so tests can assert the model was (or was not) called. */
class StubCaller implements PersonIdentitySearchCaller {
  readonly requests: IdentitySearchRequest[] = [];
  readonly model = "stub-model";
  enabled = true;

  constructor(private readonly respond: (request: IdentitySearchRequest) => unknown) {}

  async search(request: IdentitySearchRequest): Promise<unknown> {
    this.requests.push(request);
    return this.respond(request);
  }
}

const resolverWith = (respond: (request: IdentitySearchRequest) => unknown) => {
  const caller = new StubCaller(respond);
  return { caller, resolver: new OpenAIPersonIdentityResolver({ caller }) };
};

describe("acceptResolution", () => {
  it("accepts a HIGH-confidence, source-backed, matching identity", () => {
    const result = acceptResolution(HIGH_CONFIDENCE_ANSWER, INPUT);
    expect(result.outcome).toBe("RESOLVED");
    expect(result.firstName).toBe("Jared");
    expect(result.lastName).toBe("Cho");
  });

  it("rejects LOW confidence", () => {
    const result = acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, confidence: "LOW" }, INPUT);
    expect(result.outcome).toBe("UNAVAILABLE");
    expect(result.lastName).toBeNull();
  });

  it("rejects UNAVAILABLE confidence", () => {
    expect(acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, confidence: "UNAVAILABLE" }, INPUT).outcome).toBe(
      "UNAVAILABLE"
    );
  });

  it("rejects an answer that did not match the person or the employer", () => {
    expect(acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, identityMatched: false }, INPUT).outcome).toBe(
      "UNAVAILABLE"
    );
    expect(acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, companyMatched: false }, INPUT).outcome).toBe(
      "UNAVAILABLE"
    );
  });

  it("rejects an answer with no cited evidence", () => {
    expect(acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, sources: [] }, INPUT).outcome).toBe("UNAVAILABLE");
  });

  it("rejects an answer whose only citation is not a real URL", () => {
    expect(
      acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, sources: ["a public directory"] }, INPUT).outcome
    ).toBe("UNAVAILABLE");
  });

  it("rejects a resolved given name that contradicts the stored identity", () => {
    const result = acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, resolvedFirstName: "Michael" }, INPUT);
    expect(result.outcome).toBe("UNAVAILABLE");
    expect(result.firstName).toBeNull();
  });

  it("rejects a resolved given name that contradicts a known initial", () => {
    const initialOnly = { ...INPUT, displayName: "J. Cho", knownFirstName: null, knownFirstInitial: "j" };
    expect(
      acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, resolvedFirstName: "Michael" }, initialOnly).outcome
    ).toBe("UNAVAILABLE");
    expect(
      acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, resolvedFirstName: "Jared" }, initialOnly).outcome
    ).toBe("RESOLVED");
  });

  it("rejects a surname that is itself only an initial", () => {
    expect(acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, resolvedLastName: "C." }, INPUT).outcome).toBe(
      "UNAVAILABLE"
    );
  });

  it("rejects an incomplete answer", () => {
    expect(acceptResolution({ ...HIGH_CONFIDENCE_ANSWER, resolvedLastName: null }, INPUT).outcome).toBe(
      "UNAVAILABLE"
    );
  });

  it("rejects a malformed payload", () => {
    expect(acceptResolution({ nonsense: true }, INPUT).outcome).toBe("UNAVAILABLE");
    expect(acceptResolution(null, INPUT).outcome).toBe("UNAVAILABLE");
    expect(acceptResolution("Jared Cho", INPUT).outcome).toBe("UNAVAILABLE");
  });

  it("canonicalizes a resolved name that still carries decoration", () => {
    const result = acceptResolution(
      { ...HIGH_CONFIDENCE_ANSWER, resolvedLastName: "Cho M.B.A." },
      INPUT
    );
    expect(result.outcome).toBe("RESOLVED");
    expect(result.lastName).toBe("Cho");
  });
});

describe("OpenAIPersonIdentityResolver", () => {
  it("resolves a HIGH-confidence identity and spends one budget call", async () => {
    const budget = createAiBudget();
    const { resolver, caller } = resolverWith(() => HIGH_CONFIDENCE_ANSWER);

    const result = await resolver.resolve(INPUT, { budget });

    expect(result.outcome).toBe("RESOLVED");
    expect(result.lastName).toBe("Cho");
    expect(caller.requests).toHaveLength(1);
    expect(caller.requests[0]?.instructions).toBe(OPENAI_PERSON_IDENTITY_INSTRUCTIONS);
    expect(budget.usage.person_identity).toBe(1);
  });

  it("returns UNAVAILABLE safely when the provider times out or fails", async () => {
    const { resolver } = resolverWith(() => {
      throw new DOMException("aborted", "AbortError");
    });
    const result = await resolver.resolve(INPUT);
    expect(result.outcome).toBe("UNAVAILABLE");
    expect(result.lastName).toBeNull();
  });

  it("returns UNAVAILABLE safely on malformed provider output", async () => {
    const { resolver } = resolverWith(() => ({ resolvedLastName: 42 }));
    expect((await resolver.resolve(INPUT)).outcome).toBe("UNAVAILABLE");
  });

  it("refuses to call the provider without employer context", async () => {
    const { resolver, caller } = resolverWith(() => HIGH_CONFIDENCE_ANSWER);
    const result = await resolver.resolve({ ...INPUT, companyName: "  " });
    expect(result.outcome).toBe("UNAVAILABLE");
    expect(caller.requests).toHaveLength(0);
  });

  it("stops calling once the per-search budget is exhausted", async () => {
    const budget = new AiCallBudget({
      company_resolution: 0,
      role_classification: 0,
      email_pattern: 0,
      person_identity: 1
    });
    const { resolver, caller } = resolverWith(() => HIGH_CONFIDENCE_ANSWER);

    expect((await resolver.resolve(INPUT, { budget })).outcome).toBe("RESOLVED");
    expect((await resolver.resolve(INPUT, { budget })).outcome).toBe("BUDGET_EXHAUSTED");
    expect(caller.requests).toHaveLength(1);
  });

  it("produces no name when OpenAI is not configured", async () => {
    const caller = new StubCaller(() => HIGH_CONFIDENCE_ANSWER);
    caller.enabled = false;
    const resolver = new OpenAIPersonIdentityResolver({ caller });

    const result = await resolver.resolve(INPUT);

    expect(result.outcome).toBe("NOT_CONFIGURED");
    expect(result.firstName).toBeNull();
    expect(result.lastName).toBeNull();
    expect(caller.requests).toHaveLength(0);
  });

  it("never sends sensitive personal context to the provider", () => {
    const payload = buildIdentityResolutionInput(INPUT);
    const serialized = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ["phone", "homeaddress", "birth", "personalemail", "family"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(payload.employer).toBe("Apple");
  });

  it("instructs the model never to guess or derive a surname from a slug", () => {
    expect(OPENAI_PERSON_IDENTITY_INSTRUCTIONS).toContain("Never invent or guess a surname.");
    expect(OPENAI_PERSON_IDENTITY_INSTRUCTIONS).toContain("Never derive a surname from a profile URL slug.");
  });
});

describe("resolveIncompleteIdentities", () => {
  const profile = (overrides: Partial<Parameters<typeof resolveIncompleteIdentities>[0][number]> = {}) => ({
    firstName: "Jared",
    lastName: "Cho",
    fullName: "Jared Cho",
    identityStatus: "COMPLETE" as const,
    currentTitle: "Software Engineer",
    location: "Cupertino, California, United States",
    linkedinUrl: "https://www.linkedin.com/in/jared-cho",
    ...overrides
  });

  const context = (resolve: ReturnType<typeof vi.fn>, budget?: AiCallBudget) => ({
    companyName: "Apple",
    companyDomain: "apple.com",
    resolver: { resolve },
    budget
  });

  it("never calls the model for identities that parsed cleanly", async () => {
    const resolve = vi.fn();
    const profiles = [
      // A clean name, a credential-cleaned name, and an emoji-cleaned name all
      // arrive COMPLETE from the parser and must cost nothing.
      profile(),
      profile({ fullName: "Jared Cho", linkedinUrl: "https://www.linkedin.com/in/jared-cho-2" }),
      profile({ firstName: "Li", lastName: "Ma", fullName: "Li Ma" })
    ];

    const result = await resolveIncompleteIdentities(profiles, context(resolve));

    expect(resolve).not.toHaveBeenCalled();
    expect(result).toEqual(profiles);
  });

  it("calls the model for an initial-only surname and adopts a resolved identity", async () => {
    const resolve = vi.fn().mockResolvedValue({
      outcome: "RESOLVED",
      firstName: "Jared",
      lastName: "Cho",
      reason: "ok"
    });
    const profiles = [
      profile({ lastName: "", fullName: "Jared C.", identityStatus: "AMBIGUOUS" }),
      profile()
    ];

    const result = await resolveIncompleteIdentities(profiles, context(resolve));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result[0].firstName).toBe("Jared");
    expect(result[0].lastName).toBe("Cho");
    expect(result[0].identityStatus).toBe("COMPLETE");
    expect(result[1]).toEqual(profiles[1]);
  });

  it("leaves a person unresolved — and email-less — when the model cannot establish a name", async () => {
    const resolve = vi.fn().mockResolvedValue({
      outcome: "UNAVAILABLE",
      firstName: null,
      lastName: null,
      reason: "no evidence"
    });
    const input = [profile({ lastName: "", fullName: "Jared C.", identityStatus: "AMBIGUOUS" })];

    const result = await resolveIncompleteIdentities(input, context(resolve));

    expect(result[0].lastName).toBe("");
    expect(result[0].identityStatus).toBe("AMBIGUOUS");
  });

  it("calls the model for a missing surname", async () => {
    const resolve = vi.fn().mockResolvedValue({ outcome: "UNAVAILABLE", firstName: null, lastName: null, reason: "" });
    await resolveIncompleteIdentities(
      [profile({ lastName: "", fullName: "Jared", identityStatus: "INCOMPLETE" })],
      context(resolve)
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("stops the whole batch once the budget is exhausted", async () => {
    const resolve = vi.fn().mockResolvedValue({
      outcome: "BUDGET_EXHAUSTED",
      firstName: null,
      lastName: null,
      reason: "spent"
    });
    const profiles = [
      profile({ lastName: "", fullName: "Jared C.", identityStatus: "AMBIGUOUS" }),
      profile({ lastName: "", fullName: "Dana P.", identityStatus: "AMBIGUOUS" }),
      profile({ lastName: "", fullName: "Sam T.", identityStatus: "AMBIGUOUS" })
    ];

    const result = await resolveIncompleteIdentities(profiles, context(resolve));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result).toEqual(profiles);
  });

  it("never persists a hallucinated surname the resolver could not justify", async () => {
    // The port contract is that only RESOLVED carries names; anything else is
    // ignored even if the payload contains one.
    const resolve = vi.fn().mockResolvedValue({
      outcome: "UNAVAILABLE",
      firstName: "Jared",
      lastName: "Hallucinated",
      reason: "low confidence"
    });
    const result = await resolveIncompleteIdentities(
      [profile({ lastName: "", fullName: "Jared C.", identityStatus: "AMBIGUOUS" })],
      context(resolve)
    );
    expect(result[0].lastName).toBe("");
  });
});
