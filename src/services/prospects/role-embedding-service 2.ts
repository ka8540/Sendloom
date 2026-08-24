export type RoleEmbeddingConfig = {
  model: string;
  dimensions: number;
};

export interface RoleEmbeddingPort {
  readonly enabled: boolean;
  embedTitles(normalizedTitles: readonly string[]): Promise<Map<string, number[]>>;
}

type OpenAIEmbeddingResponse = {
  data?: Array<{ index?: number; embedding?: unknown }>;
};

export function validateEmbeddingVector(vector: unknown, dimensions: number): number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(`Role embedding must contain exactly ${dimensions} dimensions.`);
  }
  const validated = vector.map((value) => Number(value));
  if (validated.some((value) => !Number.isFinite(value))) {
    throw new Error("Role embedding contains a non-finite value.");
  }
  return validated;
}

export function serializeEmbeddingVector(vector: unknown, dimensions: number): string {
  return `[${validateEmbeddingVector(vector, dimensions).join(",")}]`;
}

export type OpenAIRoleEmbeddingServiceOptions = RoleEmbeddingConfig & {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxBatchSize?: number;
};

/** Batched OpenAI embeddings client. It never logs title text or raw responses. */
export class OpenAIRoleEmbeddingService implements RoleEmbeddingPort {
  readonly enabled: boolean;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBatchSize: number;

  constructor(options: OpenAIRoleEmbeddingServiceOptions) {
    this.apiKey = options.apiKey;
    this.enabled = Boolean(options.apiKey);
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxBatchSize = Math.max(1, Math.min(options.maxBatchSize ?? 100, 100));
  }

  async embedTitles(normalizedTitles: readonly string[]): Promise<Map<string, number[]>> {
    const titles = Array.from(new Set(normalizedTitles.filter(Boolean)));
    if (titles.length === 0) return new Map();
    if (!this.enabled || !this.apiKey) {
      throw new Error("Role embeddings are unavailable because OPENAI_API_KEY is not configured.");
    }

    const result = new Map<string, number[]>();
    for (let offset = 0; offset < titles.length; offset += this.maxBatchSize) {
      const batch = titles.slice(offset, offset + this.maxBatchSize);
      const response = await this.fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: this.model, dimensions: this.dimensions, input: batch })
      });
      if (!response.ok) {
        throw new Error(`Role embedding request failed with status ${response.status}.`);
      }
      const payload = (await response.json()) as OpenAIEmbeddingResponse;
      if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
        throw new Error("Role embedding response did not match the requested batch size.");
      }
      for (const [fallbackIndex, item] of payload.data.entries()) {
        const index = typeof item.index === "number" ? item.index : fallbackIndex;
        const title = batch[index];
        if (!title) throw new Error("Role embedding response contained an invalid index.");
        result.set(title, validateEmbeddingVector(item.embedding, this.dimensions));
      }
    }
    return result;
  }
}
