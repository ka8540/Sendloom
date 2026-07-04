import { afterEach, describe, expect, it, vi } from "vitest";

process.env.OPENAI_API_KEY = "sk-test";
process.env.PROSPECT_AI_ENABLED = "true";
process.env.PROSPECT_AI_MODEL = "";
process.env.PROSPECT_EMAIL_DISCOVERY_PROVIDER = "openai_web_search";
process.env.PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED = "true";

import {
  DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL,
  EMAIL_FORMAT_MAX_OUTPUT_TOKENS,
  OPENAI_EMAIL_FORMAT_INSTRUCTIONS,
  OPENAI_EMAIL_FORMAT_JSON_SCHEMA,
  OpenAIEmailFormatDiscoveryService,
  OpenAIWebSearchCaller,
  buildEmailFormatDiscoveryInput,
  type EmailFormatWebSearchCaller,
  discoveryResultToEvidenceBundle,
  validateDiscoveryResult
} from "@/services/prospects/openai-email-format-discovery";
import { createAiBudget } from "@/services/prospects/prospect-ai";

const APPLIED_MATERIALS_RAW = {
  selectedEmailDomain: "amat.com",
  selectedPattern: "first_last",
  domainConfidence: "HIGH",
  patternConfidence: "HIGH",
  supportingSources: [
    {
      label: "RocketReach",
      url: "https://rocketreach.co/applied-materials-email-format",
      sourceType: "rocketreach",
      claimedDomain: "amat.com",
      claimedPattern: "first_last",
      percentage: 84.7,
      exampleEmail: "jane_doe@amat.com"
    }
  ],
  conflictingSourceCount: 0,
  decisionCode: "VERIFIED_EXAMPLE"
} as const;

const ESRI_RAW = {
  selectedEmailDomain: "esri.com",
  selectedPattern: "flast",
  domainConfidence: "HIGH",
  patternConfidence: "HIGH",
  supportingSources: [
    {
      label: "RocketReach",
      url: "https://rocketreach.co/esri-email-format",
      sourceType: "rocketreach",
      claimedDomain: "esri.com",
      claimedPattern: "flast",
      percentage: 84.7,
      exampleEmail: "jdoe@esri.com"
    }
  ],
  conflictingSourceCount: 0,
  decisionCode: "VERIFIED_EXAMPLE"
} as const;

function fakeCaller(...responses: unknown[]): EmailFormatWebSearchCaller & { search: ReturnType<typeof vi.fn> } {
  let index = 0;
  return {
    enabled: true,
    model: "gpt-5.5",
    search: vi.fn(async () => {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response instanceof Error) {
        throw response;
      }
      return response;
    })
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenAIWebSearchCaller", () => {
  it("uses strict structured output, web search, usage metrics, and a small output cap", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify(ESRI_RAW),
        usage: { input_tokens: 102, output_tokens: 74 }
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const caller = new OpenAIWebSearchCaller({ apiKey: "sk-test", model: "gpt-5.5", enabled: true });
    const result = await caller.search({
      instructions: OPENAI_EMAIL_FORMAT_INSTRUCTIONS,
      input: JSON.stringify(buildEmailFormatDiscoveryInput({ companyName: "Esri", websiteDomain: "esri.com" })),
      schemaName: "email_format_discovery",
      jsonSchema: OPENAI_EMAIL_FORMAT_JSON_SCHEMA as unknown as Record<string, unknown>
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body)) as {
      model: string;
      tools: Array<{ type: string }>;
      max_output_tokens: number;
      instructions: string;
      input: string;
      text: { format: { type: string; strict: boolean; schema: Record<string, unknown> } };
    };
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.model).toBe("gpt-5.5");
    expect(body.max_output_tokens).toBe(EMAIL_FORMAT_MAX_OUTPUT_TOKENS);
    expect(body.max_output_tokens).toBeLessThanOrEqual(400);
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(JSON.stringify(body.text.format.schema)).not.toMatch(/reasonSummary|rationale|quote|snippet/i);
    expect(body.instructions).toContain("Do not return quotes, snippets, prose, rationale");
    expect(body.input).not.toMatch(/linkedin|targetRoles|employee list|<html/i);
    expect(result).toMatchObject({ selectedEmailDomain: "esri.com", selectedPattern: "flast" });
    expect(caller.getLastUsage()).toEqual({ inputTokens: 102, outputTokens: 74 });
  });

  it("defaults to GPT-5.5 when PROSPECT_AI_MODEL is unset", () => {
    const caller = new OpenAIWebSearchCaller({ apiKey: "sk-test", enabled: true });
    expect(caller.model).toBe(DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL);
  });
});

describe("validateDiscoveryResult", () => {
  it("keeps website and sourced employee email domains distinct", () => {
    const input = buildEmailFormatDiscoveryInput({
      companyName: "Applied Materials",
      websiteDomain: "appliedmaterials.com"
    });
    const result = validateDiscoveryResult(APPLIED_MATERIALS_RAW);
    expect(input.websiteDomain).toBe("appliedmaterials.com");
    expect(result.selectedEmailDomain).toBe("amat.com");
    expect(result.selectedPattern).toBe("first_last");
    expect(result.domainConfidence).toBe("HIGH");
  });

  it("rejects unsupported patterns, extra narrative fields, and selections absent from evidence", () => {
    expect(() =>
      validateDiscoveryResult({ ...APPLIED_MATERIALS_RAW, selectedPattern: "weird_pattern" })
    ).toThrow();
    expect(() =>
      validateDiscoveryResult({ ...APPLIED_MATERIALS_RAW, rationale: "A long explanation." })
    ).toThrow();
    expect(() =>
      validateDiscoveryResult({ ...APPLIED_MATERIALS_RAW, selectedEmailDomain: "example.com" })
    ).toThrow(/absent/i);
  });

  it("rejects personal domains rather than converting them", () => {
    expect(() =>
      validateDiscoveryResult({
        ...APPLIED_MATERIALS_RAW,
        selectedEmailDomain: "gmail.com",
        supportingSources: [
          {
            ...APPLIED_MATERIALS_RAW.supportingSources[0],
            claimedDomain: "gmail.com",
            exampleEmail: "jane.doe@gmail.com"
          }
        ]
      })
    ).toThrow();
  });

  it("deduplicates canonical source claims and lowers confidence when sources conflict", () => {
    const result = validateDiscoveryResult({
      ...ESRI_RAW,
      supportingSources: [
        ESRI_RAW.supportingSources[0],
        { ...ESRI_RAW.supportingSources[0], url: "https://rocketreach.co/esri-email-format#format" }
      ],
      conflictingSourceCount: 1
    });
    expect(result.supportingSources).toHaveLength(1);
    expect(result.domainConfidence).toBe("MEDIUM");
    expect(result.patternConfidence).toBe("MEDIUM");
  });
});

describe("discoveryResultToEvidenceBundle", () => {
  it("maps compact structured claims without storing a narrative", () => {
    const bundle = discoveryResultToEvidenceBundle(validateDiscoveryResult(ESRI_RAW), {
      now: () => new Date("2026-06-18T00:00:00.000Z")
    });
    expect(bundle.domainEvidence?.[0]).toMatchObject({
      emailDomain: "esri.com",
      observedPattern: "flast",
      sourceType: "public_format_page"
    });
    expect(bundle.patternEvidence?.[0]).toMatchObject({ pattern: "flast", emailDomain: "esri.com" });
    expect(bundle.decision).toEqual({
      decisionCode: "VERIFIED_EXAMPLE",
      supportingSourceCount: 1,
      conflictingSourceCount: 0
    });
    expect(bundle).not.toHaveProperty("reasonSummary");
  });
});

describe("OpenAIEmailFormatDiscoveryService", () => {
  it("logs only safe resolution metadata and real token usage", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const caller: EmailFormatWebSearchCaller = {
      enabled: true,
      model: "gpt-5.5",
      search: vi.fn(async () => APPLIED_MATERIALS_RAW),
      getLastUsage: () => ({ inputTokens: 120, outputTokens: 80 })
    };
    const service = new OpenAIEmailFormatDiscoveryService({ caller });

    await service.findEvidence({ companyName: "Applied Materials", officialWebsiteDomain: "appliedmaterials.com" });
    const logEntry = info.mock.calls.find((call) => call[0] === "[email-format-ai] Resolution completed.")?.[1];
    expect(logEntry).toEqual({
      operation: "web_search_resolution",
      model: "gpt-5.5",
      sourceCount: 1,
      cacheHit: false,
      aiUsed: true,
      decisionCode: "VERIFIED_EXAMPLE",
      inputTokens: 120,
      outputTokens: 80
    });
  });

  it("runs once, consumes the shared budget, and sends only the compact identity payload", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const caller = fakeCaller(APPLIED_MATERIALS_RAW);
    const service = new OpenAIEmailFormatDiscoveryService({ caller });
    const budget = createAiBudget();

    const bundle = await service.findEvidence({
      companyName: "Applied Materials, Inc.",
      officialWebsiteDomain: "appliedmaterials.com",
      knownLinkedinUrl: "https://linkedin.com/company/applied-materials",
      targetRoles: ["Engineer", "Employee One", "Employee Two"],
      budget
    });

    expect(caller.search).toHaveBeenCalledTimes(1);
    const request = caller.search.mock.calls[0][0];
    expect(Object.keys(JSON.parse(request.input))).toEqual(["company", "websiteDomain", "suggestedQueries"]);
    expect(request.input).not.toContain("linkedin.com");
    expect(request.input).not.toContain("Employee One");
    expect(request.maxOutputTokens).toBeLessThanOrEqual(400);
    expect(bundle.domainEvidence?.[0]).toMatchObject({ emailDomain: "amat.com", observedPattern: "first_last" });
    expect(budget.canCall("email_pattern")).toBe(false);

    await service.findEvidence({
      companyName: "Applied Materials, Inc.",
      officialWebsiteDomain: "appliedmaterials.com",
      budget
    });
    expect(caller.search).toHaveBeenCalledTimes(1);
  });

  it("retries invalid JSON once using the same compact payload", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const caller = fakeCaller({ bad: true }, ESRI_RAW);
    const service = new OpenAIEmailFormatDiscoveryService({ caller });

    const bundle = await service.findEvidence({ companyName: "Esri", officialWebsiteDomain: "esri.com" });
    expect(caller.search).toHaveBeenCalledTimes(2);
    expect(caller.search.mock.calls[0][0].input).toBe(caller.search.mock.calls[1][0].input);
    expect(caller.search.mock.calls[1][0].instructions).toContain("corrected JSON only");
    expect(bundle.patternEvidence?.[0]?.pattern).toBe("flast");
  });

  it("stops after one retry and falls back safely", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const caller = fakeCaller({ bad: true }, { stillBad: true });
    const service = new OpenAIEmailFormatDiscoveryService({ caller });

    await expect(service.findEvidence({ companyName: "Esri", officialWebsiteDomain: "esri.com" }))
      .resolves.toEqual({});
    expect(caller.search).toHaveBeenCalledTimes(2);
  });

  it("does not retry transport failures as though they were invalid JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const caller = fakeCaller(new Error("rate limited"));
    const service = new OpenAIEmailFormatDiscoveryService({ caller });

    await expect(service.findEvidence({ companyName: "Esri", officialWebsiteDomain: "esri.com" }))
      .resolves.toEqual({});
    expect(caller.search).toHaveBeenCalledTimes(1);
  });

  it("does not run web search for a pasted source URL", async () => {
    const caller = fakeCaller(ESRI_RAW);
    const service = new OpenAIEmailFormatDiscoveryService({ caller });
    await expect(service.findEvidence({
      companyName: "Esri",
      officialWebsiteDomain: "esri.com",
      sourceUrl: "https://rocketreach.co/esri-email-format"
    })).resolves.toEqual({});
    expect(caller.search).not.toHaveBeenCalled();
  });
});
