import { vi } from "vitest";
import { OpenAiProspectClient } from "../prospect-ai";

export async function withRaeNameAI(run: () => Promise<void>) {
  const enabled = vi.spyOn(OpenAiProspectClient.prototype, "enabled", "get").mockReturnValue(true);
  const complete = vi.spyOn(OpenAiProspectClient.prototype, "complete").mockImplementation(async request => {
    if (request.taskType !== "person_identity") throw new Error("Unexpected mock task");
    const input = JSON.parse(request.input) as { items: Array<{ id: string; sourceName: string }> };
    return { items: input.items.map(p => {
      if (p.sourceName !== "Rae Gruppman SHRM-CP") throw new Error("Unexpected source fixture");
      return { id: p.id, displayName: "Rae Gruppman", givenName: "Rae", familyName: "Gruppman", middleNames: [],
        generationalSuffix: null, removedTokens: ["SHRM-CP"], confidence: "HIGH", canGenerateEmail: true };
    }) };
  });
  try { await run(); expectBatchCalls(); } finally { complete.mockRestore(); enabled.mockRestore(); }
  function expectBatchCalls() {
    if (!complete.mock.calls.length) throw new Error("Expected the real batch normalizer to call mock OpenAI");
  }
}
