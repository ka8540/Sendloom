import type { AiClient, AiCompletionRequest, AiTaskType } from "@/services/prospects/prospect-ai";

export type MockAiOptions = {
  enabled?: boolean;
  responses?: Partial<Record<AiTaskType, unknown>>;
  handler?: (request: AiCompletionRequest) => unknown;
};

/**
 * A mock AiClient that records every call (so tests can assert AI is used at
 * most once per task and never per person) and returns canned, per-task output.
 */
export function createMockAi(options: MockAiOptions = {}) {
  const calls: AiCompletionRequest[] = [];

  const client: AiClient = {
    enabled: options.enabled ?? true,
    model: "mock-model",
    async complete(request) {
      calls.push(request);
      if (options.handler) {
        return options.handler(request);
      }
      const response = options.responses?.[request.taskType];
      if (response === undefined) {
        throw new Error(`No mock AI response configured for ${request.taskType}.`);
      }
      return response;
    }
  };

  return {
    client,
    calls,
    callsOfType(type: AiTaskType) {
      return calls.filter((call) => call.taskType === type);
    }
  };
}
