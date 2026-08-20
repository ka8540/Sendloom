import { describe, expect, it, vi } from "vitest";

import {
  OpenAIRoleEmbeddingService,
  serializeEmbeddingVector,
  validateEmbeddingVector
} from "@/services/prospects/role-embedding-service";

describe("role embedding validation", () => {
  it("rejects wrong dimensions and non-finite values before persistence", () => {
    expect(() => validateEmbeddingVector([1, 2], 3)).toThrow(/exactly 3/);
    expect(() => validateEmbeddingVector([1, Number.NaN, 3], 3)).toThrow(/non-finite/);
    expect(() => validateEmbeddingVector([1, Number.POSITIVE_INFINITY, 3], 3)).toThrow(/non-finite/);
    expect(serializeEmbeddingVector([1, 2, 3], 3)).toBe("[1,2,3]");
  });

  it("batches distinct titles into bounded OpenAI embedding calls", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(
        JSON.stringify({ data: body.input.map((_title, index) => ({ index, embedding: [index + 1, 0, 0] })) }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    const service = new OpenAIRoleEmbeddingService({
      apiKey: "test-key",
      model: "text-embedding-test",
      dimensions: 3,
      maxBatchSize: 2,
      fetchImpl
    });
    const result = await service.embedTitles(["software engineer", "software engineer", "ios engineer", "recruiter"]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect([...result.keys()]).toEqual(["software engineer", "ios engineer", "recruiter"]);
  });
});
