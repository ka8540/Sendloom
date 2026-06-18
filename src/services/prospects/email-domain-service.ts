import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  CONFIDENCE_LEVELS,
  EMAIL_PATTERNS,
  type ConfidenceLevel,
  type EmailPattern,
  coerceConfidenceLevel,
  isConfidenceLevel,
  isEmailPattern
} from "@/lib/prospect-enums";
import { type AiCallBudget, type AiClient } from "@/services/prospects/prospect-ai";
import {
  isPersonalEmailDomain,
  normalizeDomain,
  normalizeNameForEmail
} from "@/services/prospects/prospect-normalization";

export type EmailEvidenceSourceType =
  | "verified_email_sample"
  | "public_format_page"
  | "search_snippet"
  | "hunter"
  | "manual_override";

export type EmailDomainEvidence = {
  emailDomain: string;
  sourceName: string;
  sourceUrl?: string | null;
  sourceType: EmailEvidenceSourceType;
  observedPattern?: EmailPattern | null;
  percentage?: number | null;
  confidence: ConfidenceLevel;
  observedAt: string;
};

export type EmailPatternEvidence = {
  pattern: EmailPattern;
  emailDomain?: string | null;
  percentage?: number | null;
  sourceName: string;
  sourceUrl?: string | null;
  sourceType: EmailEvidenceSourceType;
  confidence: ConfidenceLevel;
  observedAt: string;
};

export type EmailEvidenceBundle = {
  domainEvidence?: EmailDomainEvidence[];
  patternEvidence?: EmailPatternEvidence[];
};

export type EmailEvidenceProviderInput = {
  companyName: string;
  officialWebsiteDomain: string | null;
  sourceUrl?: string | null;
};

export interface EmailEvidenceProvider {
  findEvidence(input: EmailEvidenceProviderInput): Promise<EmailEvidenceBundle>;
}

export type CompanyEmailInferenceResult = {
  selectedEmailDomain: string | null;
  emailDomainConfidence: ConfidenceLevel;
  emailDomainEvidence: EmailDomainEvidence[];
  selectedPattern: EmailPattern | null;
  patternConfidence: ConfidenceLevel;
  patternEvidence: EmailPatternEvidence[];
  reasonSummary: string | null;
};

export type InferCompanyEmailInput = {
  userId: string;
  companyId?: string | null;
  companyName: string;
  officialWebsiteDomain: string | null | undefined;
  sourceUrl?: string | null;
  extraEvidence?: EmailEvidenceBundle;
  budget: AiCallBudget;
  searchId?: string | null;
};

type RankedEvidence = {
  index: number;
  emailDomain: string | null;
  pattern: EmailPattern | null;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: EmailEvidenceSourceType;
  percentage: number | null;
  confidence: ConfidenceLevel;
  observedAt: string;
};

const BLOCKED_EMAIL_DOMAINS = new Set([
  "linkedin.com",
  "rocketreach.co",
  "hunter.io",
  "apollo.io",
  "zoominfo.com",
  "crunchbase.com",
  "glassdoor.com",
  "indeed.com"
]);

const SOURCE_WEIGHT: Record<EmailEvidenceSourceType, number> = {
  manual_override: 100,
  verified_email_sample: 90,
  hunter: 78,
  public_format_page: 70,
  search_snippet: 42
};

const CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  HIGH: 20,
  MEDIUM: 12,
  LOW: 4,
  UNAVAILABLE: 0
};

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  UNAVAILABLE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3
};

const AI_EMAIL_INFERENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["selectedEmailDomain", "selectedPattern", "confidence", "reasonSummary", "evidenceIndexesUsed"],
  properties: {
    selectedEmailDomain: { type: ["string", "null"] },
    selectedPattern: { type: ["string", "null"], enum: [...EMAIL_PATTERNS, null] },
    confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    reasonSummary: { type: ["string", "null"] },
    evidenceIndexesUsed: { type: "array", items: { type: "number" } }
  }
} as const;

const aiEmailInferenceSchema = z.object({
  selectedEmailDomain: z.string().nullable(),
  selectedPattern: z.string().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS as unknown as [string, ...string[]]),
  reasonSummary: z.string().nullable(),
  evidenceIndexesUsed: z.array(z.number())
});

const AI_INSTRUCTIONS = [
  "You rank evidence for a company's employee email domain and local-part email pattern.",
  "You are ranking evidence, not guessing.",
  "You may only select an email domain that appears in evidence.",
  "You may only select an email pattern that appears in evidence.",
  "If evidence conflicts, choose lower confidence or return null with UNAVAILABLE.",
  "If website domain and employee email domain differ, preserve both.",
  "Never infer employee email domain solely from website domain.",
  "Never fabricate percentages.",
  "Never mark inferred emails as verified.",
  `selectedPattern must be one of: ${EMAIL_PATTERNS.join(", ")}.`,
  "Return strict JSON only."
].join(" ");

class NoopEmailEvidenceProvider implements EmailEvidenceProvider {
  async findEvidence(): Promise<EmailEvidenceBundle> {
    return {};
  }
}

function isBlockedEmailDomain(domain: string | null | undefined): boolean {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return true;
  }
  if (isPersonalEmailDomain(normalized)) {
    return true;
  }
  return BLOCKED_EMAIL_DOMAINS.has(normalized);
}

function normalizeConfidence(value: unknown): ConfidenceLevel {
  return coerceConfidenceLevel(value);
}

function minConfidence(...levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce<ConfidenceLevel>(
    (lowest, current) => (CONFIDENCE_RANK[current] < CONFIDENCE_RANK[lowest] ? current : lowest),
    "HIGH"
  );
}

function confidenceFromHunterScore(score: unknown): ConfidenceLevel {
  if (typeof score !== "number") {
    return "MEDIUM";
  }
  if (score >= 85) {
    return "HIGH";
  }
  if (score >= 60) {
    return "MEDIUM";
  }
  return "LOW";
}

function sourceUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function observedAt(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

function localPartForPattern(pattern: EmailPattern, first: string, last: string): string | null {
  const f = first[0] ?? "";
  const l = last[0] ?? "";
  switch (pattern) {
    case "first":
      return first;
    case "last":
      return last;
    case "firstlast":
      return `${first}${last}`;
    case "first.last":
      return `${first}.${last}`;
    case "first_last":
      return `${first}_${last}`;
    case "flast":
      return `${f}${last}`;
    case "f.last":
      return `${f}.${last}`;
    case "f_last":
      return `${f}_${last}`;
    case "firstl":
      return `${first}${l}`;
    case "first.l":
      return `${first}.${l}`;
    case "lastf":
      return `${last}${f}`;
    case "last.first":
      return `${last}.${first}`;
    default:
      return null;
  }
}

export function inferPatternFromEmailSample(email: string, firstName: string, lastName: string): EmailPattern | null {
  const localPart = email.split("@")[0]?.trim().toLowerCase();
  if (!localPart) {
    return null;
  }
  const { first, last } = normalizeNameForEmail(firstName, lastName);
  if (!first || !last) {
    return null;
  }
  for (const pattern of EMAIL_PATTERNS) {
    if (localPartForPattern(pattern, first, last) === localPart) {
      return pattern;
    }
  }
  return null;
}

function splitName(name: unknown): { firstName: string; lastName: string } {
  if (typeof name !== "string") {
    return { firstName: "", lastName: "" };
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : ""
  };
}

function normalizeDomainEvidence(evidence: EmailDomainEvidence[]): EmailDomainEvidence[] {
  return evidence
    .map((row): EmailDomainEvidence | null => {
      const emailDomain = normalizeDomain(row.emailDomain);
      if (!emailDomain || isBlockedEmailDomain(emailDomain)) {
        return null;
      }
      const observedPattern = isEmailPattern(row.observedPattern) ? row.observedPattern : null;
      return {
        emailDomain,
        sourceName: row.sourceName?.trim() || "evidence",
        sourceUrl: sourceUrl(row.sourceUrl),
        sourceType: row.sourceType,
        observedPattern,
        percentage: typeof row.percentage === "number" ? row.percentage : null,
        confidence: normalizeConfidence(row.confidence),
        observedAt: observedAt(row.observedAt)
      };
    })
    .filter((row): row is EmailDomainEvidence => Boolean(row));
}

function normalizePatternEvidence(evidence: EmailPatternEvidence[]): EmailPatternEvidence[] {
  return evidence
    .map((row): EmailPatternEvidence | null => {
      if (!isEmailPattern(row.pattern)) {
        return null;
      }
      const emailDomain = normalizeDomain(row.emailDomain);
      if (emailDomain && isBlockedEmailDomain(emailDomain)) {
        return null;
      }
      return {
        pattern: row.pattern,
        emailDomain,
        percentage: typeof row.percentage === "number" ? row.percentage : null,
        sourceName: row.sourceName?.trim() || "evidence",
        sourceUrl: sourceUrl(row.sourceUrl),
        sourceType: row.sourceType,
        confidence: normalizeConfidence(row.confidence),
        observedAt: observedAt(row.observedAt)
      };
    })
    .filter((row): row is EmailPatternEvidence => Boolean(row));
}

function dedupeDomainEvidence(rows: EmailDomainEvidence[]): EmailDomainEvidence[] {
  const seen = new Set<string>();
  const deduped: EmailDomainEvidence[] = [];
  for (const row of rows) {
    const key = [
      row.emailDomain,
      row.observedPattern ?? "",
      row.sourceName,
      row.sourceUrl ?? "",
      row.sourceType
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function dedupePatternEvidence(rows: EmailPatternEvidence[]): EmailPatternEvidence[] {
  const seen = new Set<string>();
  const deduped: EmailPatternEvidence[] = [];
  for (const row of rows) {
    const key = [row.pattern, row.emailDomain ?? "", row.sourceName, row.sourceUrl ?? "", row.sourceType].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function buildRankedEvidence(domainEvidence: EmailDomainEvidence[], patternEvidence: EmailPatternEvidence[]): RankedEvidence[] {
  const rows: RankedEvidence[] = [];
  for (const row of domainEvidence) {
    rows.push({
      index: rows.length,
      emailDomain: row.emailDomain,
      pattern: row.observedPattern ?? null,
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl ?? null,
      sourceType: row.sourceType,
      percentage: row.percentage ?? null,
      confidence: row.confidence,
      observedAt: row.observedAt
    });
  }
  for (const row of patternEvidence) {
    rows.push({
      index: rows.length,
      emailDomain: row.emailDomain ?? null,
      pattern: row.pattern,
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl ?? null,
      sourceType: row.sourceType,
      percentage: row.percentage ?? null,
      confidence: row.confidence,
      observedAt: row.observedAt
    });
  }
  return rows;
}

function scoreEvidence(rows: RankedEvidence[]): number {
  const sourceNames = new Set<string>();
  let score = 0;
  for (const row of rows) {
    score += SOURCE_WEIGHT[row.sourceType] + CONFIDENCE_WEIGHT[row.confidence] + (row.percentage ?? 0) / 5;
    sourceNames.add(`${row.sourceType}:${row.sourceName}:${row.sourceUrl ?? ""}`);
  }
  if (sourceNames.size > 1) {
    score += (sourceNames.size - 1) * 20;
  }
  return score;
}

function confidenceForEvidence(rows: RankedEvidence[]): ConfidenceLevel {
  if (rows.length === 0) {
    return "UNAVAILABLE";
  }
  if (rows.some((row) => row.sourceType === "manual_override" && row.confidence === "HIGH")) {
    return "HIGH";
  }
  if (rows.some((row) => row.sourceType === "verified_email_sample" && row.confidence !== "LOW")) {
    return "HIGH";
  }
  if (
    rows.some(
      (row) => row.sourceType === "public_format_page" && row.confidence === "HIGH" && (row.percentage ?? 0) >= 80
    )
  ) {
    return "HIGH";
  }
  if (rows.some((row) => row.sourceType === "hunter" && row.confidence === "HIGH")) {
    return "HIGH";
  }
  const distinctSources = new Set(rows.map((row) => `${row.sourceType}:${row.sourceName}:${row.sourceUrl ?? ""}`));
  if (distinctSources.size >= 2 && rows.some((row) => row.sourceType !== "search_snippet")) {
    return "HIGH";
  }
  if (rows.some((row) => row.sourceType === "hunter" || row.sourceType === "public_format_page")) {
    return rows.some((row) => row.confidence === "LOW") ? "LOW" : "MEDIUM";
  }
  return distinctSources.size >= 2 ? "MEDIUM" : "LOW";
}

function bestByKey<T extends string>(
  rows: RankedEvidence[],
  keyOf: (row: RankedEvidence) => T | null
): { key: T | null; rows: RankedEvidence[]; confidence: ConfidenceLevel } {
  const groups = new Map<T, RankedEvidence[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let bestKey: T | null = null;
  let bestRows: RankedEvidence[] = [];
  let bestScore = -1;
  for (const [key, group] of groups) {
    const score = scoreEvidence(group);
    if (score > bestScore) {
      bestKey = key;
      bestRows = group;
      bestScore = score;
    }
  }
  return { key: bestKey, rows: bestRows, confidence: confidenceForEvidence(bestRows) };
}

function selectEvidenceForDomain(domain: string | null, evidence: EmailDomainEvidence[]): EmailDomainEvidence[] {
  return domain ? evidence.filter((row) => row.emailDomain === domain) : [];
}

function selectEvidenceForPattern(
  pattern: EmailPattern | null,
  domain: string | null,
  evidence: EmailPatternEvidence[]
): EmailPatternEvidence[] {
  if (!pattern) {
    return [];
  }
  const direct = evidence.filter((row) => row.pattern === pattern && (!domain || !row.emailDomain || row.emailDomain === domain));
  return direct.length > 0 ? direct : evidence.filter((row) => row.pattern === pattern);
}

function deterministicSelection(
  domainEvidence: EmailDomainEvidence[],
  patternEvidence: EmailPatternEvidence[]
): CompanyEmailInferenceResult {
  const ranked = buildRankedEvidence(domainEvidence, patternEvidence);
  const domain = bestByKey(ranked, (row) => row.emailDomain);
  const patternRows = domain.key ? ranked.filter((row) => !row.emailDomain || row.emailDomain === domain.key) : ranked;
  const pattern = bestByKey<EmailPattern>(patternRows, (row) => row.pattern);

  if (!domain.key || !pattern.key) {
    return {
      selectedEmailDomain: domain.key,
      emailDomainConfidence: domain.confidence,
      emailDomainEvidence: selectEvidenceForDomain(domain.key, domainEvidence),
      selectedPattern: null,
      patternConfidence: "UNAVAILABLE",
      patternEvidence: [],
      reasonSummary: domain.key
        ? "Email domain evidence was found, but no supported email pattern was evidence-backed."
        : "No evidence-backed employee email domain was found."
    };
  }

  return {
    selectedEmailDomain: domain.key,
    emailDomainConfidence: domain.confidence,
    emailDomainEvidence: selectEvidenceForDomain(domain.key, domainEvidence),
    selectedPattern: pattern.key,
    patternConfidence: pattern.confidence,
    patternEvidence: selectEvidenceForPattern(pattern.key, domain.key, patternEvidence),
    reasonSummary: "Selected from ranked evidence."
  };
}

function domainAppearsInEvidence(domain: string, rows: RankedEvidence[]): boolean {
  return rows.some((row) => row.emailDomain === domain);
}

function patternAppearsInEvidence(pattern: EmailPattern, rows: RankedEvidence[]): boolean {
  return rows.some((row) => row.pattern === pattern);
}

function highConfidenceAllowed(rows: RankedEvidence[]): boolean {
  return confidenceForEvidence(rows) === "HIGH";
}

export function buildEmailFormatSearchQueries(companyName: string, websiteDomain: string | null): string[] {
  const queries = [
    `"${companyName}" email format`,
    `"${companyName}" email pattern`,
    `"${companyName}" employee email format`,
    `site:rocketreach.co "${companyName} Email Format"`,
    `site:rocketreach.co "${companyName}" "Email Format"`,
    `site:hunter.io "${companyName}" "email format"`
  ];
  if (websiteDomain) {
    queries.push(`"${websiteDomain}" email format`);
    queries.push(`"${websiteDomain}" email pattern`);
    queries.push(`site:hunter.io "${websiteDomain}" "email pattern"`);
  }
  return queries;
}

export class EmailDomainService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ai: AiClient,
    private readonly evidenceProvider: EmailEvidenceProvider = new NoopEmailEvidenceProvider()
  ) {}

  async infer(input: InferCompanyEmailInput): Promise<CompanyEmailInferenceResult> {
    const officialWebsiteDomain = normalizeDomain(input.officialWebsiteDomain);
    const providerEvidence = await this.evidenceProvider.findEvidence({
      companyName: input.companyName,
      officialWebsiteDomain,
      sourceUrl: input.sourceUrl ?? null
    });
    const hunterEvidence = await this.collectHunterEvidence(input.userId, officialWebsiteDomain);

    const domainEvidence = dedupeDomainEvidence(
      normalizeDomainEvidence([
        ...(providerEvidence.domainEvidence ?? []),
        ...(hunterEvidence.domainEvidence ?? []),
        ...(input.extraEvidence?.domainEvidence ?? [])
      ])
    );
    const patternEvidence = dedupePatternEvidence(
      normalizePatternEvidence([
        ...(providerEvidence.patternEvidence ?? []),
        ...(hunterEvidence.patternEvidence ?? []),
        ...(input.extraEvidence?.patternEvidence ?? [])
      ])
    );

    const deterministic = deterministicSelection(domainEvidence, patternEvidence);
    const ranked = buildRankedEvidence(domainEvidence, patternEvidence);

    if (ranked.length === 0 || !this.ai.enabled || !input.budget.canCall("email_pattern")) {
      this.logInferenceResult(input, ranked, deterministic);
      return deterministic;
    }

    input.budget.record("email_pattern");
    try {
      const raw = await this.ai.complete({
        taskType: "email_pattern",
        instructions: AI_INSTRUCTIONS,
        input: JSON.stringify({
          company: input.companyName,
          officialWebsiteDomain,
          evidence: ranked,
          allowedPatterns: EMAIL_PATTERNS
        }),
        schemaName: "company_email_inference",
        jsonSchema: AI_EMAIL_INFERENCE_JSON_SCHEMA as unknown as Record<string, unknown>,
        inputItemCount: ranked.length,
        searchId: input.searchId,
        maxOutputTokens: 500
      });

      const parsed = aiEmailInferenceSchema.parse(raw);
      const selectedDomain = normalizeDomain(parsed.selectedEmailDomain);
      const selectedPattern = isEmailPattern(parsed.selectedPattern) ? parsed.selectedPattern : null;

      if (!selectedDomain || isBlockedEmailDomain(selectedDomain) || !domainAppearsInEvidence(selectedDomain, ranked)) {
        this.logInferenceResult(input, ranked, deterministic);
        return deterministic;
      }
      if (!selectedPattern || !patternAppearsInEvidence(selectedPattern, ranked)) {
        this.logInferenceResult(input, ranked, deterministic);
        return deterministic;
      }

      const usedRows = parsed.evidenceIndexesUsed
        .map((index) => ranked.find((row) => row.index === index))
        .filter((row): row is RankedEvidence => Boolean(row));
      const selectedRows = usedRows.length > 0
        ? usedRows
        : ranked.filter((row) => row.emailDomain === selectedDomain || row.pattern === selectedPattern);
      if (parsed.confidence === "HIGH" && !highConfidenceAllowed(selectedRows)) {
        this.logInferenceResult(input, ranked, deterministic);
        return deterministic;
      }

      const aiConfidence = coerceConfidenceLevel(parsed.confidence);
      const domainConfidence = minConfidence(aiConfidence, confidenceForEvidence(ranked.filter((row) => row.emailDomain === selectedDomain)));
      const patternConfidence = minConfidence(
        aiConfidence,
        confidenceForEvidence(ranked.filter((row) => row.pattern === selectedPattern))
      );

      const result = {
        selectedEmailDomain: selectedDomain,
        emailDomainConfidence: domainConfidence,
        emailDomainEvidence: selectEvidenceForDomain(selectedDomain, domainEvidence),
        selectedPattern,
        patternConfidence,
        patternEvidence: selectEvidenceForPattern(selectedPattern, selectedDomain, patternEvidence),
        reasonSummary: parsed.reasonSummary
      };
      this.logInferenceResult(input, ranked, result);
      return result;
    } catch (error) {
      console.warn("[prospect] email inference AI failed", error instanceof Error ? error.message : error);
      this.logInferenceResult(input, ranked, deterministic);
      return deterministic;
    }
  }

  private async collectHunterEvidence(userId: string, officialWebsiteDomain: string | null): Promise<EmailEvidenceBundle> {
    const client = this.prisma as PrismaClient & {
      hunterDomainSearch?: {
        findMany(args: unknown): Promise<Array<{ domain: string; results: unknown; updatedAt: Date }>>;
      };
    };
    if (!client.hunterDomainSearch) {
      return {};
    }

    const where = officialWebsiteDomain ? { userId, domain: { in: [officialWebsiteDomain] } } : { userId };
    const rows = await client.hunterDomainSearch.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 10
    });

    const domainEvidence: EmailDomainEvidence[] = [];
    const patternEvidence: EmailPatternEvidence[] = [];

    for (const row of rows) {
      const results = Array.isArray(row.results) ? (row.results as Array<Record<string, unknown>>) : [];
      for (const result of results) {
        const email = typeof result.email === "string" ? result.email.trim().toLowerCase() : "";
        const emailDomain = normalizeDomain(email);
        if (!email || !emailDomain || isBlockedEmailDomain(emailDomain)) {
          continue;
        }
        const name = splitName(result.name);
        const observedPattern = inferPatternFromEmailSample(email, name.firstName, name.lastName);
        const confidence = confidenceFromHunterScore(result.confidence);
        const common = {
          sourceName: "Hunter domain search",
          sourceUrl: null,
          sourceType: "hunter" as const,
          percentage: null,
          confidence,
          observedAt: observedAt(row.updatedAt)
        };
        domainEvidence.push({
          emailDomain,
          observedPattern,
          ...common
        });
        if (observedPattern) {
          patternEvidence.push({
            pattern: observedPattern,
            emailDomain,
            ...common
          });
        }
      }
    }

    return { domainEvidence, patternEvidence };
  }

  private logInferenceResult(
    input: Pick<InferCompanyEmailInput, "searchId" | "companyId">,
    ranked: RankedEvidence[],
    result: CompanyEmailInferenceResult
  ) {
    this.logInference({
      searchId: input.searchId,
      companyId: input.companyId,
      evidenceCount: ranked.length,
      candidateEmailDomains: [...new Set(ranked.map((row) => row.emailDomain).filter(Boolean) as string[])],
      candidatePatterns: [...new Set(ranked.map((row) => row.pattern).filter(Boolean) as string[])],
      selectedEmailDomain: result.selectedEmailDomain,
      selectedPattern: result.selectedPattern,
      confidence: minConfidence(result.emailDomainConfidence, result.patternConfidence)
    });
  }

  private logInference(entry: {
    searchId?: string | null;
    companyId?: string | null;
    evidenceCount: number;
    candidateEmailDomains: string[];
    candidatePatterns: string[];
    selectedEmailDomain: string | null;
    selectedPattern: EmailPattern | null;
    confidence: ConfidenceLevel;
  }) {
    if (process.env.NODE_ENV === "production") {
      return;
    }
    console.info("[prospect-email-inference]", JSON.stringify({ ...entry, model: this.ai.model }));
  }
}

export function isAllowedBusinessEmailDomain(domain: string | null | undefined): boolean {
  const normalized = normalizeDomain(domain);
  return Boolean(normalized && !isBlockedEmailDomain(normalized));
}

export function makeManualEmailDomainEvidence(input: {
  emailDomain: string;
  emailPattern: EmailPattern;
  confidence: ConfidenceLevel;
  reason?: string | null;
}): { domainEvidence: EmailDomainEvidence; patternEvidence: EmailPatternEvidence } {
  const emailDomain = normalizeDomain(input.emailDomain);
  if (!emailDomain || isBlockedEmailDomain(emailDomain)) {
    throw new Error("Enter a valid business email domain.");
  }
  if (!isEmailPattern(input.emailPattern)) {
    throw new Error("Enter a supported email pattern.");
  }
  if (!isConfidenceLevel(input.confidence)) {
    throw new Error("Enter a valid confidence level.");
  }
  const observedAtIso = new Date().toISOString();
  return {
    domainEvidence: {
      emailDomain,
      sourceName: "Manual override",
      sourceUrl: null,
      sourceType: "manual_override",
      observedPattern: input.emailPattern,
      percentage: null,
      confidence: input.confidence,
      observedAt: observedAtIso,
      ...(input.reason ? { reason: input.reason } : {})
    } as EmailDomainEvidence,
    patternEvidence: {
      pattern: input.emailPattern,
      emailDomain,
      percentage: null,
      sourceName: "Manual override",
      sourceUrl: null,
      sourceType: "manual_override",
      confidence: input.confidence,
      observedAt: observedAtIso,
      ...(input.reason ? { reason: input.reason } : {})
    } as EmailPatternEvidence
  };
}
