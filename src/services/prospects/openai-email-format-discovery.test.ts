import { afterEach, describe, expect, it, vi } from "vitest";

// Configure the AI web-search discovery gate before the env is first read.
process.env.OPENAI_API_KEY = "sk-test";
process.env.PROSPECT_AI_ENABLED = "true";
process.env.PROSPECT_AI_MODEL = "";
process.env.PROSPECT_EMAIL_DISCOVERY_PROVIDER = "openai_web_search";
process.env.PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED = "true";

import {
  DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL,
  OPENAI_EMAIL_FORMAT_JSON_SCHEMA,
  OpenAIEmailFormatDiscoveryService,
  OpenAIWebSearchCaller,
  type EmailFormatWebSearchCaller,
  discoveryResultToEvidenceBundle,
  normalizeDiscoveryPattern,
  validateDiscoveryResult
} from "@/services/prospects/openai-email-format-discovery";
import { createAiBudget } from "@/services/prospects/prospect-ai";

const APPLIED_MATERIALS_RAW = {
  companyName: "Applied Materials, Inc.",
  websiteDomain: "appliedmaterials.com",
  selectedEmailDomain: "amat.com",
  selectedPattern: "first_last",
  confidence: "HIGH",
  reasonSummary: "Public evidence shows first_last on amat.com.",
  evidence: [
    {
      sourceName: "RocketReach",
      sourceUrl: "https://rocketreach.co/applied-materials-email-format",
      sourceType: "rocketreach",
      patternRaw: "[first]_[last]",
      normalizedPattern: "first_last",
      exampleEmail: "jane_doe@amat.com",
      emailDomain: "amat.com",
      percentage: 84.7,
      quote: "most common"
    }
  ]
};

const ESRI_RAW = {
  companyName: "Esri",
  websiteDomain: "esri.com",
  selectedEmailDomain: "esri.com",
  selectedPattern: "flast",
  confidence: "HIGH",
  reasonSummary: "RocketReach shows flast on esri.com.",
  evidence: [
    {
      sourceName: "RocketReach",
      sourceUrl: "https://rocketreach.co/esri-email-format",
      sourceType: "rocketreach",
      patternRaw: "[first_initial][last]",
      normalizedPattern: "flast",
      exampleEmail: "jdoe@esri.com",
      emailDomain: "esri.com",
      percentage: 84.7,
      quote: "most common"
    }
  ]
};

function fakeCaller(response: unknown): EmailFormatWebSearchCaller & { search: ReturnType<typeof vi.fn> } {
  return {
    enabled: true,
    model: "gpt-5.5",
    search: vi.fn(async () => response)
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenAIWebSearchCaller", () => {
  it("calls the Responses API with the web_search tool and the configured model (#1, #2)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(ESRI_RAW) })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const caller = new OpenAIWebSearchCaller({ apiKey: "sk-test", model: "gpt-5.5", enabled: true });
    const result = await caller.search({
      instructions: "Find the format.",
      input: "{}",
      schemaName: "email_format_discovery",
      jsonSchema: OPENAI_EMAIL_FORMAT_JSON_SCHEMA as unknown as Record<string, unknown>
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body)) as {
      model: string;
      tools: Array<{ type: string }>;
      text: { format: { type: string } };
    };
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.model).toBe("gpt-5.5");
    expect(body.text.format.type).toBe("json_schema");
    // #3: structured output is parsed back into an object.
    expect(result).toMatchObject({ companyName: "Esri", selectedEmailDomain: "esri.com" });
  });

  it("defaults to GPT-5.5 when PROSPECT_AI_MODEL is unset", () => {
    const caller = new OpenAIWebSearchCaller({ apiKey: "sk-test", enabled: true });
    expect(caller.model).toBe(DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL);
    expect(caller.model).toBe("gpt-5.5");
  });
});

describe("normalizeDiscoveryPattern", () => {
  it("prefers a supported normalizedPattern", () => {
    expect(normalizeDiscoveryPattern({ normalizedPattern: "first_last" })).toBe("first_last");
  });

  it("maps bracket syntax from patternRaw", () => {
    expect(normalizeDiscoveryPattern({ patternRaw: "[first_initial][last]" })).toBe("flast");
  });

  it("rejects unsupported pattern tokens (#4)", () => {
    expect(normalizeDiscoveryPattern({ normalizedPattern: "weird", patternRaw: "weird" })).toBeNull();
  });
});

describe("validateDiscoveryResult", () => {
  it("keeps a sourced, quantified Applied Materials result at HIGH (#7)", () => {
    const result = validateDiscoveryResult(APPLIED_MATERIALS_RAW, { websiteDomain: "appliedmaterials.com" });
    expect(result.selectedEmailDomain).toBe("amat.com");
    expect(result.selectedPattern).toBe("first_last");
    expect(result.confidence).toBe("HIGH");
    // Website domain and email domain stay separate.
    expect(result.websiteDomain).toBe("appliedmaterials.com");
    expect(result.selectedEmailDomain).not.toBe(result.websiteDomain);
  });

  it("rejects an unsupported selected pattern (#4)", () => {
    const result = validateDiscoveryResult({
      ...APPLIED_MATERIALS_RAW,
      selectedPattern: "weird_pattern",
      evidence: [{ ...APPLIED_MATERIALS_RAW.evidence[0], normalizedPattern: "weird_pattern", patternRaw: "weird" }]
    });
    expect(result.selectedPattern).toBeNull();
  });

  it("rejects a selected domain that is absent from the evidence (#5)", () => {
    const result = validateDiscoveryResult({
      ...ESRI_RAW,
      selectedEmailDomain: "amat.com" // not present in the esri.com evidence
    });
    expect(result.selectedEmailDomain).toBeNull();
  });

  it("rejects personal email domains in evidence and selection (#6)", () => {
    const result = validateDiscoveryResult({
      companyName: "Personal Co",
      websiteDomain: "personalco.com",
      selectedEmailDomain: "gmail.com",
      selectedPattern: "first_last",
      confidence: "HIGH",
      reasonSummary: "x",
      evidence: [
        {
          sourceName: "Blog",
          sourceUrl: "https://example.test/post",
          sourceType: "other",
          patternRaw: null,
          normalizedPattern: null,
          exampleEmail: "jane.doe@gmail.com",
          emailDomain: "gmail.com",
          percentage: 99,
          quote: null
        }
      ]
    });
    expect(result.selectedEmailDomain).toBeNull();
    const bundle = discoveryResultToEvidenceBundle(result);
    expect(bundle.domainEvidence).toHaveLength(0);
  });

  it("truncates over-long quotes", () => {
    const longQuote = "x".repeat(500);
    const result = validateDiscoveryResult({
      ...ESRI_RAW,
      evidence: [{ ...ESRI_RAW.evidence[0], quote: longQuote }]
    });
    expect((result.evidence[0].quote ?? "").length).toBeLessThanOrEqual(281);
  });
});

describe("discoveryResultToEvidenceBundle", () => {
  it("maps the Esri result onto domain + pattern evidence (#8)", () => {
    const result = validateDiscoveryResult(ESRI_RAW, { websiteDomain: "esri.com" });
    const bundle = discoveryResultToEvidenceBundle(result, { now: () => new Date("2026-06-18T00:00:00.000Z") });
    expect(bundle.domainEvidence?.[0]).toMatchObject({
      emailDomain: "esri.com",
      observedPattern: "flast",
      sourceType: "public_format_page"
    });
    expect(bundle.patternEvidence?.[0]).toMatchObject({ pattern: "flast", emailDomain: "esri.com" });
  });
});

describe("OpenAIEmailFormatDiscoveryService", () => {
  it("runs the web search once per company and consumes the email_pattern budget (#9)", async () => {
    const caller = fakeCaller(APPLIED_MATERIALS_RAW);
    const service = new OpenAIEmailFormatDiscoveryService({ caller });
    const budget = createAiBudget();

    const bundle = await service.findEvidence({
      companyName: "Applied Materials, Inc.",
      officialWebsiteDomain: "appliedmaterials.com",
      budget
    });

    expect(caller.search).toHaveBeenCalledTimes(1);
    expect(bundle.domainEvidence?.[0]).toMatchObject({ emailDomain: "amat.com", observedPattern: "first_last" });
    // The budget is now exhausted so the deterministic selector — not a second
    // model call — chooses the final format.
    expect(budget.canCall("email_pattern")).toBe(false);

    const second = await service.findEvidence({
      companyName: "Applied Materials, Inc.",
      officialWebsiteDomain: "appliedmaterials.com",
      budget
    });
    expect(caller.search).toHaveBeenCalledTimes(1);
    expect(second.domainEvidence ?? []).toHaveLength(0);
  });

  it("does not run a web search when a source URL is pasted", async () => {
    const caller = fakeCaller(ESRI_RAW);
    const service = new OpenAIEmailFormatDiscoveryService({ caller });

    const bundle = await service.findEvidence({
      companyName: "Esri",
      officialWebsiteDomain: "esri.com",
      sourceUrl: "https://rocketreach.co/esri-email-format"
    });

    expect(caller.search).not.toHaveBeenCalled();
    expect(bundle).toEqual({});
  });

  it("degrades to an empty bundle when the web search throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const caller: EmailFormatWebSearchCaller = {
      enabled: true,
      model: "gpt-5.5",
      search: vi.fn(async () => {
        throw new Error("rate limited");
      })
    };
    const service = new OpenAIEmailFormatDiscoveryService({ caller });

    const bundle = await service.findEvidence({ companyName: "Esri", officialWebsiteDomain: "esri.com" });
    expect(bundle).toEqual({});
  });
});
