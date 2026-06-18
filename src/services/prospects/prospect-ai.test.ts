import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiProspectClient } from "@/services/prospects/prospect-ai";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenAiProspectClient", () => {
  it("uses a GPT-5.5-compatible reasoning effort instead of the legacy minimal value", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ ok: true }) })
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => {});

    const client = new OpenAiProspectClient({
      apiKey: "sk-test",
      model: "gpt-5.5",
      reasoningEffort: "low",
      enabled: true
    });

    await expect(
      client.complete({
        taskType: "company_resolution",
        instructions: "Return JSON.",
        input: "{}",
        schemaName: "test_schema",
        jsonSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
        inputItemCount: 1,
        searchId: "search_1"
      })
    ).resolves.toEqual({ ok: true });

    const request = fetchMock.mock.calls[0][1];
    expect(request).toBeDefined();
    const body = JSON.parse(String(request!.body)) as { model: string; reasoning: { effort: string } };
    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning.effort).toBe("low");
    expect(body.reasoning.effort).not.toBe("minimal");
  });
});
