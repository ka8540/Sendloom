import { z } from "zod";

const HUNTER_API_BASE = "https://api.hunter.io/v2";

const hunterSourceSchema = z
  .object({
    domain: z.string().optional()
  })
  .passthrough();

const hunterEmailFinderSchema = z
  .object({
    data: z
      .object({
        email: z.string().nullable().optional(),
        score: z.number().nullable().optional(),
        confidence: z.number().nullable().optional(),
        first_name: z.string().nullable().optional(),
        last_name: z.string().nullable().optional(),
        position: z.string().nullable().optional(),
        domain: z.string().nullable().optional(),
        sources: z.array(hunterSourceSchema).optional()
      })
      .nullable()
      .optional(),
    errors: z.array(z.object({ details: z.string().optional(), id: z.string().optional() })).optional()
  })
  .passthrough();

const hunterDomainSearchSchema = z
  .object({
    data: z
      .object({
        domain: z.string().nullable().optional(),
        emails: z
          .array(
            z
              .object({
                value: z.string().optional(),
                first_name: z.string().nullable().optional(),
                last_name: z.string().nullable().optional(),
                position: z.string().nullable().optional(),
                confidence: z.number().nullable().optional(),
                domain: z.string().nullable().optional(),
                sources: z.array(hunterSourceSchema).optional()
              })
              .passthrough()
          )
          .optional()
      })
      .nullable()
      .optional(),
    errors: z.array(z.object({ details: z.string().optional(), id: z.string().optional() })).optional()
  })
  .passthrough();

export type HunterResultRow = {
  email: string;
  name: string;
  position: string | null;
  confidence: number | null;
  source: string;
};

export class HunterApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HunterApiError";
    this.status = status;
  }
}

function normalizeHunterErrorMessage(payload: { errors?: Array<{ details?: string; id?: string }> } | null, fallback: string) {
  if (!payload?.errors?.length) {
    return fallback;
  }

  return payload.errors
    .map((entry) => entry.details || entry.id)
    .filter(Boolean)
    .join(" ");
}

export function normalizeHunterDomain(input: string) {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new HunterApiError("Enter a company domain first.");
  }

  const stripped = trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(stripped)) {
    throw new HunterApiError("Enter a valid company domain like stripe.com.");
  }

  return stripped;
}

function buildHunterUrl(path: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  return `${HUNTER_API_BASE}${path}?${searchParams.toString()}`;
}

async function fetchHunter<T extends z.ZodTypeAny>(path: string, params: Record<string, string>, schema: T): Promise<z.infer<T>> {
  const response = await fetch(buildHunterUrl(path, params), {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => null)) as { errors?: Array<{ details?: string; id?: string }> } | null;

  if (!response.ok) {
    const fallback =
      response.status === 401
        ? "Your Hunter API key is invalid. Update it in Settings and try again."
        : response.status === 429
          ? "Hunter rate limit reached. Try again in a minute."
          : response.status >= 500
            ? "Hunter is temporarily unavailable. Try again shortly."
            : "Hunter request failed.";

    throw new HunterApiError(normalizeHunterErrorMessage(payload, fallback), response.status);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new HunterApiError("Hunter returned an unexpected response.");
  }

  return parsed.data;
}

function formatHunterName(firstName?: string | null, lastName?: string | null) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function mapHunterRow(input: {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  confidence?: number | null;
  score?: number | null;
  domain?: string | null;
  sources?: Array<{ domain?: string }>;
}): HunterResultRow | null {
  const email = input.email?.trim();
  if (!email) {
    return null;
  }

  return {
    email,
    name: formatHunterName(input.first_name, input.last_name) || "Unknown",
    position: input.position?.trim() || null,
    confidence: input.confidence ?? input.score ?? null,
    source: input.sources?.find((source) => source.domain)?.domain ?? input.domain ?? email.split("@")[1] ?? "Unknown"
  };
}

export async function findHunterEmail(apiKey: string, firstName: string, lastName: string, domain: string) {
  const payload = await fetchHunter(
    "/email-finder",
    {
      domain: normalizeHunterDomain(domain),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      api_key: apiKey
    },
    hunterEmailFinderSchema
  );

  const row = mapHunterRow(payload.data ?? {});
  return row ? [row] : [];
}

export async function searchHunterDomain(apiKey: string, domain: string) {
  const normalizedDomain = normalizeHunterDomain(domain);
  const payload = await fetchHunter(
    "/domain-search",
    {
      domain: normalizedDomain,
      limit: "100",
      api_key: apiKey
    },
    hunterDomainSearchSchema
  );

  const rows = (payload.data?.emails ?? [])
    .map((entry) =>
      mapHunterRow({
        email: entry.value,
        first_name: entry.first_name,
        last_name: entry.last_name,
        position: entry.position,
        confidence: entry.confidence,
        domain: entry.domain ?? payload.data?.domain ?? normalizedDomain,
        sources: entry.sources
      })
    )
    .filter((entry): entry is HunterResultRow => Boolean(entry));

  return rows;
}
