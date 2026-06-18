// Canonical enum values for the prospect graph. These arrays are the single
// source of truth shared by the Prisma string columns, the Zod validators, and
// the GraphQL schema/enums so the API boundary never trusts arbitrary values
// (e.g. AI output) directly.

export const POSITION_CATEGORIES = [
  "SOFTWARE_ENGINEERING",
  "HUMAN_RESOURCES",
  "DATA_ANALYTICS",
  "DATA_ENGINEERING",
  "DATA_SCIENCE",
  "PRODUCT",
  "DESIGN",
  "MARKETING",
  "SALES",
  "FINANCE",
  "OPERATIONS",
  "RECRUITING",
  "MANAGEMENT",
  "OTHER"
] as const;

export type PositionCategory = (typeof POSITION_CATEGORIES)[number];

export const POSITION_DISPLAY_NAMES: Record<PositionCategory, string> = {
  SOFTWARE_ENGINEERING: "Software Engineering",
  HUMAN_RESOURCES: "Human Resources",
  DATA_ANALYTICS: "Data Analytics",
  DATA_ENGINEERING: "Data Engineering",
  DATA_SCIENCE: "Data Science",
  PRODUCT: "Product",
  DESIGN: "Design",
  MARKETING: "Marketing",
  SALES: "Sales",
  FINANCE: "Finance",
  OPERATIONS: "Operations",
  RECRUITING: "Recruiting",
  MANAGEMENT: "Management",
  OTHER: "Other"
};

export const PROSPECT_SEARCH_STATUSES = [
  "DRAFT",
  "RESOLVING_COMPANY",
  "SEARCHING_PEOPLE",
  "CLASSIFYING_POSITIONS",
  "INFERRING_EMAIL_PATTERN",
  "READY",
  "FAILED",
  "CANCELED"
] as const;

export type ProspectSearchStatus = (typeof PROSPECT_SEARCH_STATUSES)[number];

export const EMAIL_CANDIDATE_STATUSES = [
  "VERIFIED",
  "INFERRED_HIGH",
  "INFERRED_MEDIUM",
  "INFERRED_LOW",
  "UNAVAILABLE",
  "SUPPRESSED",
  "INVALID"
] as const;

export type EmailCandidateStatus = (typeof EMAIL_CANDIDATE_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "UNAVAILABLE"] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

// Supported deterministic email-pattern tokens. The AI may only ever SELECT
// from this set; it never generates the addresses themselves.
export const EMAIL_PATTERNS = [
  "first",
  "last",
  "firstlast",
  "first.last",
  "first_last",
  "flast",
  "f.last",
  "f_last",
  "firstl",
  "first.l",
  "lastf",
  "last.first"
] as const;

export type EmailPattern = (typeof EMAIL_PATTERNS)[number];

export function isEmailPattern(value: unknown): value is EmailPattern {
  return typeof value === "string" && (EMAIL_PATTERNS as readonly string[]).includes(value);
}

export function isPositionCategory(value: unknown): value is PositionCategory {
  return typeof value === "string" && (POSITION_CATEGORIES as readonly string[]).includes(value);
}

export function coercePositionCategory(value: unknown): PositionCategory {
  return isPositionCategory(value) ? value : "OTHER";
}

export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

export function coerceConfidenceLevel(value: unknown): ConfidenceLevel {
  return isConfidenceLevel(value) ? value : "UNAVAILABLE";
}

export function displayNameForCategory(category: PositionCategory): string {
  return POSITION_DISPLAY_NAMES[category];
}
