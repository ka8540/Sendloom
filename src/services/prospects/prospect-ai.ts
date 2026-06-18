import { env } from "@/lib/env";

// Default model for prospect AI tasks; override with PROSPECT_AI_MODEL for the
// latest model available in the local environment (for example, gpt-5.5).
export const DEFAULT_PROSPECT_AI_MODEL = "gpt-5";

export type AiTaskType = "company_resolution" | "role_classification" | "email_pattern";

export type AiCompletionRequest = {
  taskType: AiTaskType;
  /** System-level instructions (kept out of logs). */
  instructions: string;
  /** User input payload, already JSON-stringified (kept out of logs). */
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Number of items the model is reasoning over (titles, evidence, etc.). */
  inputItemCount: number;
  searchId?: string | null;
  maxOutputTokens?: number;
};

export interface AiClient {
  readonly enabled: boolean;
  readonly model: string;
  /** Returns the parsed (but not yet domain-validated) JSON object. */
  complete(request: AiCompletionRequest): Promise<unknown>;
}

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

function extractOutputText(response: OpenAIResponse): string {
  const direct = response.output_text?.trim();
  if (direct) {
    return direct;
  }
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      const text = content.text?.trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

// Emit a single structured telemetry line per AI call. Deliberately excludes
// prompts, personal data, candidate emails, raw payloads, and API keys.
function logAiCall(entry: {
  searchId?: string | null;
  taskType: AiTaskType;
  model: string;
  inputItemCount: number;
  latencyMs: number;
  success: boolean;
}) {
  console.info("[prospect-ai]", JSON.stringify(entry));
}

export class OpenAiProspectClient implements AiClient {
  readonly model: string;
  private readonly apiKey?: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.apiKey = options?.apiKey ?? env.OPENAI_API_KEY;
    this.model = options?.model ?? env.PROSPECT_AI_MODEL ?? DEFAULT_PROSPECT_AI_MODEL;
  }

  get enabled(): boolean {
    return Boolean(env.PROSPECT_AI_ENABLED && this.apiKey);
  }

  async complete(request: AiCompletionRequest): Promise<unknown> {
    if (!this.enabled) {
      throw new Error("Prospect AI is disabled or OPENAI_API_KEY is missing.");
    }

    const startedAt = Date.now();
    let success = false;
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          reasoning: { effort: "minimal" },
          instructions: request.instructions,
          input: request.input,
          max_output_tokens: request.maxOutputTokens ?? 1200,
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              strict: true,
              schema: request.jsonSchema
            }
          }
        })
      });

      const payload = (await response.json()) as OpenAIResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Prospect AI request failed.");
      }

      const text = extractOutputText(payload);
      if (!text) {
        throw new Error("Prospect AI returned an empty result.");
      }

      const parsed = JSON.parse(text) as unknown;
      success = true;
      return parsed;
    } finally {
      logAiCall({
        searchId: request.searchId,
        taskType: request.taskType,
        model: this.model,
        inputItemCount: request.inputItemCount,
        latencyMs: Date.now() - startedAt,
        success
      });
    }
  }
}

/**
 * Per-search AI call budget. Hard-caps the number of model calls of each task
 * type so a single search can never fan out into per-person AI usage. Services
 * must check `canCall` before invoking the model and fall back deterministically
 * when the budget is exhausted.
 */
export class AiCallBudget {
  private readonly counts: Record<AiTaskType, number> = {
    company_resolution: 0,
    role_classification: 0,
    email_pattern: 0
  };

  constructor(private readonly limits: Record<AiTaskType, number>) {}

  canCall(task: AiTaskType): boolean {
    return this.counts[task] < this.limits[task];
  }

  record(task: AiTaskType): void {
    this.counts[task] += 1;
  }

  get usage(): Record<AiTaskType, number> {
    return { ...this.counts };
  }

  get total(): number {
    return this.counts.company_resolution + this.counts.role_classification + this.counts.email_pattern;
  }
}

export function createAiBudget(): AiCallBudget {
  return new AiCallBudget({
    company_resolution: env.PROSPECT_AI_MAX_COMPANY_CALLS_PER_SEARCH,
    role_classification: env.PROSPECT_AI_MAX_ROLE_CALLS_PER_SEARCH,
    email_pattern: env.PROSPECT_AI_MAX_PATTERN_CALLS_PER_SEARCH
  });
}
