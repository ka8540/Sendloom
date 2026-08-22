import type { ConfidenceLevel, PositionCategory } from "@/lib/prospect-enums";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";

export const ROLE_SPECIALTIES = [
  "GENERAL",
  "BACKEND",
  "FRONTEND",
  "FULLSTACK",
  "MOBILE_IOS",
  "MOBILE_ANDROID",
  "MOBILE_GENERAL",
  "PLATFORM",
  "INFRASTRUCTURE",
  "DEVOPS",
  "FORWARD_DEPLOYED",
  "SOLUTIONS",
  "DATA_ENGINEERING",
  "DATA_SCIENCE",
  "DATA_ANALYTICS",
  "RECRUITING",
  "HUMAN_RESOURCES",
  "MANAGEMENT",
  "UNKNOWN"
] as const;

export type RoleSpecialty = (typeof ROLE_SPECIALTIES)[number];
export type RoleBreadth = "BROAD" | "NARROW";
export type RoleMatchContext = "CACHE" | "PROVIDER";
export type RoleLeadership = "INDIVIDUAL_CONTRIBUTOR" | "MANAGER" | "EXECUTIVE";
export type RoleLeadershipConstraint = "UNSPECIFIED" | RoleLeadership;
export type RoleMatchKind = "EXACT" | "ALIAS" | "FAMILY" | "BROAD_POLICY" | "VECTOR";
export type RoleMatchRejectionReason = "CATEGORY" | "FAMILY" | "LEADERSHIP" | "VECTOR";

export type RoleIntent = {
  rawTitle: string;
  normalizedTitle: string;
  canonicalRoleKey: string;
  category: PositionCategory;
  specialty: RoleSpecialty;
  familyTokens: readonly string[];
  detectedLeadership: RoleLeadership;
  leadershipConstraint: RoleLeadershipConstraint;
  breadth: RoleBreadth;
  classificationConfidence: ConfidenceLevel;
};

export type RoleMatchDecision = {
  kind: RoleMatchKind;
  score: number;
};

export type RoleMatchEvaluation = {
  decision: RoleMatchDecision | null;
  rejectionReason: RoleMatchRejectionReason | null;
};

export const ROLE_VECTOR_THRESHOLDS = {
  narrowCache: 0.84,
  provider: 0.9
} as const;

const MANAGER_PATTERN = /\b(manager|management)\b/;
const EXECUTIVE_PATTERN =
  /\b(director|head|vice president|vp|chief|cto|cio|ceo|cfo|coo|cmo|cpo|cro|chro)\b/;
const INDIVIDUAL_CONTRIBUTOR_PATTERN = /\b(individual contributor|ic only|non-managerial)\b/;

const NON_SPECIALIZING_ROLE_TOKENS = new Set([
  "and",
  "analyst",
  "associate",
  "business",
  "chief",
  "consultant",
  "contributor",
  "coordinator",
  "director",
  "executive",
  "for",
  "generalist",
  "head",
  "individual",
  "intern",
  "jr",
  "junior",
  "lead",
  "leader",
  "management",
  "managerial",
  "manager",
  "non",
  "of",
  "officer",
  "partner",
  "president",
  "principal",
  "professional",
  "representative",
  "senior",
  "specialist",
  "sr",
  "staff",
  "the",
  "vice",
  "vp"
]);

const CATEGORY_ROLE_TOKENS: Record<PositionCategory, ReadonlySet<string>> = {
  SOFTWARE_ENGINEERING: new Set(["application", "applications", "developer", "development", "engineer", "engineering", "software"]),
  HUMAN_RESOURCES: new Set(["hr", "hrbp", "human", "operations", "ops", "people", "personnel", "resource", "resources"]),
  DATA_ANALYTICS: new Set(["analysis", "analytics", "analytical", "data", "insight", "insights"]),
  DATA_ENGINEERING: new Set(["data", "engineer", "engineering"]),
  DATA_SCIENCE: new Set(["data", "science", "scientist"]),
  PRODUCT: new Set(["product"]),
  DESIGN: new Set(["design", "designer"]),
  MARKETING: new Set(["marketer", "marketing"]),
  SALES: new Set(["sale", "sales", "selling"]),
  FINANCE: new Set(["finance", "financial"]),
  OPERATIONS: new Set(["operation", "operational", "operations", "ops"]),
  RECRUITING: new Set(["acquisition", "recruiter", "recruiting", "recruitment", "sourcer", "sourcing", "talent"]),
  MANAGEMENT: new Set(["management", "manager"]),
  OTHER: new Set()
};

const PROVIDER_EXPANSIONS: Record<string, readonly string[]> = {
  "software:general": [
    "Software Developer",
    "Backend Software Engineer",
    "Frontend Software Engineer",
    "Application Developer"
  ],
  "software:backend": ["Backend Developer", "Backend Software Engineer"],
  "software:frontend": ["Frontend Developer", "Frontend Software Engineer"],
  "software:fullstack": ["Full Stack Developer", "Full Stack Software Engineer"],
  "software:ios": ["iOS Developer", "Mobile iOS Engineer"],
  "software:android": ["Android Developer", "Mobile Android Engineer"],
  "software:platform": ["Platform Software Engineer", "Platform Developer"],
  "software:infrastructure": ["Infrastructure Software Engineer"],
  "software:devops": ["DevOps Engineer", "Site Reliability Engineer"],
  "software:fde": ["Forward Deployed Software Engineer"],
  "management:cto": ["Chief Technology Officer"],
  "recruiting:general": ["Recruiter", "Talent Acquisition Specialist"],
  "human_resources:general": [
    "Human Resources",
    "HR Business Partner",
    "HR Generalist",
    "HR Specialist",
    "People Operations",
    "Human Resources Business Partner",
    "Human Resources Generalist",
    "Human Resources Specialist"
  ]
};

// Small, high-confidence provider variants for algorithmically broad
// functional intents. These are provider inputs only; role authorization is
// governed by category/family/leadership policy rather than this list.
const BROAD_PROVIDER_VARIANTS: Partial<Record<PositionCategory, readonly string[]>> = {
  DATA_ANALYTICS: ["Data Analyst", "Analytics Specialist", "Business Intelligence Analyst"],
  DATA_ENGINEERING: ["Data Engineer", "Analytics Engineer"],
  DATA_SCIENCE: ["Data Scientist", "Applied Scientist"],
  PRODUCT: ["Product Manager", "Product Owner", "Product Lead"],
  DESIGN: ["Designer", "Design Specialist", "Design Associate", "Design Coordinator"],
  MARKETING: ["Marketing Specialist", "Marketing Coordinator", "Marketing Associate"],
  SALES: ["Sales Specialist", "Sales Representative", "Sales Associate", "Sales Coordinator"],
  FINANCE: ["Finance Analyst", "Financial Analyst", "Finance Specialist", "Finance Associate"],
  OPERATIONS: ["Operations Specialist", "Operations Coordinator", "Operations Associate"]
};

const BROAD_SOFTWARE_SPECIALTIES = new Set<RoleSpecialty>([
  "GENERAL",
  "BACKEND",
  "FRONTEND",
  "FULLSTACK",
  "MOBILE_IOS",
  "MOBILE_ANDROID",
  "MOBILE_GENERAL",
  "PLATFORM",
  "INFRASTRUCTURE"
]);

const PROVIDER_SOFTWARE_SPECIALTIES = new Set<RoleSpecialty>([
  "GENERAL",
  "BACKEND",
  "FRONTEND",
  "FULLSTACK",
  "PLATFORM",
  "INFRASTRUCTURE"
]);

const SOFTWARE_FAMILY_TOKENS: Partial<Record<RoleSpecialty, readonly string[]>> = {
  BACKEND: ["backend"],
  FRONTEND: ["frontend"],
  FULLSTACK: ["fullstack"],
  MOBILE_IOS: ["ios"],
  MOBILE_ANDROID: ["android"],
  MOBILE_GENERAL: ["mobile"],
  PLATFORM: ["platform"],
  INFRASTRUCTURE: ["infrastructure"],
  DEVOPS: ["devops"],
  FORWARD_DEPLOYED: ["forward", "deployed"],
  SOLUTIONS: ["solutions"]
};

function canonicalSoftwareKey(normalizedTitle: string, specialty: RoleSpecialty): string {
  if (specialty === "GENERAL") return "software:general";
  if (specialty === "BACKEND") return "software:backend";
  if (specialty === "FRONTEND") return "software:frontend";
  if (specialty === "FULLSTACK") return "software:fullstack";
  if (specialty === "MOBILE_IOS") return "software:ios";
  if (specialty === "MOBILE_ANDROID") return "software:android";
  if (specialty === "MOBILE_GENERAL") return "software:mobile";
  if (specialty === "PLATFORM") return "software:platform";
  if (specialty === "INFRASTRUCTURE") return "software:infrastructure";
  if (specialty === "DEVOPS") return "software:devops";
  if (specialty === "FORWARD_DEPLOYED") return "software:fde";
  if (specialty === "SOLUTIONS") return "software:solutions";
  return `software:${normalizedTitle}`;
}

export function inferRoleSpecialty(normalizedTitle: string, category: PositionCategory): RoleSpecialty {
  if (category === "DATA_ENGINEERING") return "DATA_ENGINEERING";
  if (category === "DATA_SCIENCE") return "DATA_SCIENCE";
  if (category === "DATA_ANALYTICS") return "DATA_ANALYTICS";
  if (category === "RECRUITING") return "RECRUITING";
  if (category === "HUMAN_RESOURCES") return "HUMAN_RESOURCES";
  if (category === "MANAGEMENT") return "MANAGEMENT";
  if (category !== "SOFTWARE_ENGINEERING") return "UNKNOWN";

  if (/\bforward deployed\b/.test(normalizedTitle)) return "FORWARD_DEPLOYED";
  if (/\bios\b/.test(normalizedTitle)) return "MOBILE_IOS";
  if (/\bandroid\b/.test(normalizedTitle)) return "MOBILE_ANDROID";
  if (/\bsolutions? engineer\b/.test(normalizedTitle)) return "SOLUTIONS";
  if (/\b(devops|site reliability|sre)\b/.test(normalizedTitle)) return "DEVOPS";
  if (/\b(back[ -]?end|server[ -]?side)\b/.test(normalizedTitle)) return "BACKEND";
  if (/\b(front[ -]?end|client[ -]?side)\b/.test(normalizedTitle)) return "FRONTEND";
  if (/\b(full[ -]?stack|fullstack)\b/.test(normalizedTitle)) return "FULLSTACK";
  if (/\bplatform\b/.test(normalizedTitle)) return "PLATFORM";
  if (/\b(infrastructure|systems engineer)\b/.test(normalizedTitle)) return "INFRASTRUCTURE";
  if (/\bmobile\b/.test(normalizedTitle)) return "MOBILE_GENERAL";
  return "GENERAL";
}

export function inferRoleLeadership(normalizedTitle: string): RoleLeadership {
  if (EXECUTIVE_PATTERN.test(normalizedTitle)) return "EXECUTIVE";
  if (MANAGER_PATTERN.test(normalizedTitle)) return "MANAGER";
  return "INDIVIDUAL_CONTRIBUTOR";
}

export function inferQueryLeadershipConstraint(
  normalizedTitle: string
): RoleLeadershipConstraint {
  if (EXECUTIVE_PATTERN.test(normalizedTitle)) return "EXECUTIVE";
  if (MANAGER_PATTERN.test(normalizedTitle)) return "MANAGER";
  if (INDIVIDUAL_CONTRIBUTOR_PATTERN.test(normalizedTitle)) {
    return "INDIVIDUAL_CONTRIBUTOR";
  }
  return "UNSPECIFIED";
}

function normalizedTitleTokens(normalizedTitle: string): string[] {
  return normalizedTitle.split(/[\s/+&-]+/).filter(Boolean);
}

export function inferRoleFamilyTokens(
  normalizedTitle: string,
  category: PositionCategory,
  specialty: RoleSpecialty
): readonly string[] {
  if (category === "SOFTWARE_ENGINEERING") {
    return SOFTWARE_FAMILY_TOKENS[specialty] ?? [];
  }
  const categoryTokens = CATEGORY_ROLE_TOKENS[category];
  return [
    ...new Set(
      normalizedTitleTokens(normalizedTitle).filter(
        (token) => !categoryTokens.has(token) && !NON_SPECIALIZING_ROLE_TOKENS.has(token)
      )
    )
  ];
}

function canonicalRoleKey(
  normalizedTitle: string,
  category: PositionCategory,
  specialty: RoleSpecialty,
  familyTokens: readonly string[]
): string {
  if (category === "SOFTWARE_ENGINEERING") {
    return canonicalSoftwareKey(normalizedTitle, specialty);
  }
  if (category === "MANAGEMENT" && /\b(cto|chief technology officer)\b/.test(normalizedTitle)) {
    return "management:cto";
  }
  if (category === "RECRUITING") {
    return familyTokens.length === 0 ? "recruiting:general" : `recruiting:${familyTokens.join("-")}`;
  }
  if (category === "OTHER" || category === "MANAGEMENT") {
    return `${category.toLowerCase()}:${normalizedTitle}`;
  }
  return `${category.toLowerCase()}:${familyTokens.length === 0 ? "general" : familyTokens.join("-")}`;
}

export function deriveRoleIntent(input: {
  rawTitle: string;
  category: PositionCategory;
  confidence?: ConfidenceLevel;
}): RoleIntent | null {
  const normalizedTitle = normalizeTitle(input.rawTitle);
  if (!normalizedTitle) return null;
  const specialty = inferRoleSpecialty(normalizedTitle, input.category);
  const familyTokens = inferRoleFamilyTokens(normalizedTitle, input.category, specialty);
  const breadth: RoleBreadth =
    input.category !== "OTHER" &&
    input.category !== "MANAGEMENT" &&
    familyTokens.length === 0
      ? "BROAD"
      : "NARROW";
  return {
    rawTitle: input.rawTitle.trim(),
    normalizedTitle,
    canonicalRoleKey: canonicalRoleKey(normalizedTitle, input.category, specialty, familyTokens),
    category: input.category,
    specialty,
    familyTokens,
    detectedLeadership: inferRoleLeadership(normalizedTitle),
    leadershipConstraint: inferQueryLeadershipConstraint(normalizedTitle),
    breadth,
    classificationConfidence: input.confidence ?? "MEDIUM"
  };
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function finiteSimilarity(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rankingBoost(value: number | null | undefined, weight: number): number {
  const similarity = finiteSimilarity(value);
  return similarity === null ? 0 : Math.max(0, Math.min(1, similarity)) * weight;
}

function leadershipCompatible(query: RoleIntent, candidate: RoleIntent): boolean {
  return query.leadershipConstraint === "UNSPECIFIED"
    || query.leadershipConstraint === candidate.detectedLeadership;
}

function broadFamilyCompatible(query: RoleIntent, candidate: RoleIntent, context: RoleMatchContext): boolean {
  if (query.category !== "SOFTWARE_ENGINEERING") return true;
  const allowed = context === "PROVIDER" ? PROVIDER_SOFTWARE_SPECIALTIES : BROAD_SOFTWARE_SPECIALTIES;
  return allowed.has(candidate.specialty);
}

function familyTokenOverlap(left: readonly string[], right: readonly string[]): number {
  const rightTokens = new Set(right);
  return new Set(left.filter((token) => rightTokens.has(token))).size;
}

function explicitAliasesForIntent(intent: RoleIntent): readonly string[] {
  return PROVIDER_EXPANSIONS[intent.canonicalRoleKey] ?? [];
}

function areExplicitAliases(query: RoleIntent, candidate: RoleIntent): boolean {
  if (query.canonicalRoleKey !== candidate.canonicalRoleKey) return false;
  const queryAliases = new Set(explicitAliasesForIntent(query).map((title) => normalizeTitle(title)));
  const candidateAliases = new Set(explicitAliasesForIntent(candidate).map((title) => normalizeTitle(title)));
  return queryAliases.has(candidate.normalizedTitle) || candidateAliases.has(query.normalizedTitle);
}

/**
 * Functional authorization and semantic ranking are intentionally separate.
 * Category, role-family breadth, and leadership guards authorize deterministic
 * matches first. A vector can rank those matches, or authorize only a narrow
 * same-category relationship whose meaningful family tokens already overlap.
 */
export function evaluateRoleMatch(input: {
  query: RoleIntent;
  candidate: RoleIntent;
  context: RoleMatchContext;
  vectorSimilarity?: number | null;
}): RoleMatchEvaluation {
  const { query, candidate, context } = input;
  if (query.category !== candidate.category) {
    return { decision: null, rejectionReason: "CATEGORY" };
  }
  if (query.normalizedTitle === candidate.normalizedTitle) {
    return { decision: { kind: "EXACT", score: 1_000 }, rejectionReason: null };
  }
  if (query.category === "OTHER") {
    return { decision: null, rejectionReason: "FAMILY" };
  }
  if (!leadershipCompatible(query, candidate)) {
    return { decision: null, rejectionReason: "LEADERSHIP" };
  }
  if (areExplicitAliases(query, candidate)) {
    return {
      decision: {
        kind: "ALIAS",
        score:
          900 +
          tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 10 +
          rankingBoost(input.vectorSimilarity, 20)
      },
      rejectionReason: null
    };
  }
  if (query.breadth === "BROAD") {
    if (!broadFamilyCompatible(query, candidate, context)) {
      return { decision: null, rejectionReason: "FAMILY" };
    }
    return {
      decision: {
        kind: "BROAD_POLICY",
        score:
          800 +
          tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 20 +
          rankingBoost(input.vectorSimilarity, 50)
      },
      rejectionReason: null
    };
  }
  if (query.canonicalRoleKey === candidate.canonicalRoleKey) {
    return {
      decision: {
        kind: "FAMILY",
        score:
          850 +
          tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 20 +
          rankingBoost(input.vectorSimilarity, 30)
      },
      rejectionReason: null
    };
  }
  if (query.category === "MANAGEMENT" || query.category === "SOFTWARE_ENGINEERING") {
    return { decision: null, rejectionReason: "FAMILY" };
  }
  if (familyTokenOverlap(query.familyTokens, candidate.familyTokens) === 0) {
    return { decision: null, rejectionReason: "FAMILY" };
  }

  const similarity = finiteSimilarity(input.vectorSimilarity);
  if (similarity !== null) {
    const threshold =
      context === "PROVIDER"
        ? ROLE_VECTOR_THRESHOLDS.provider
        : ROLE_VECTOR_THRESHOLDS.narrowCache;
    if (similarity < threshold) {
      return { decision: null, rejectionReason: "VECTOR" };
    }
    return {
      decision: {
        kind: "VECTOR",
        score: 700 + similarity * 100 + tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 20
      },
      rejectionReason: null
    };
  }
  return { decision: null, rejectionReason: "VECTOR" };
}

export function decideRoleMatch(input: {
  query: RoleIntent;
  candidate: RoleIntent;
  context: RoleMatchContext;
  vectorSimilarity?: number | null;
}): RoleMatchDecision | null {
  return evaluateRoleMatch(input).decision;
}

export function providerAliasesForIntent(intent: RoleIntent): readonly string[] {
  const aliases = [
    ...explicitAliasesForIntent(intent),
    ...(intent.breadth === "BROAD" ? (BROAD_PROVIDER_VARIANTS[intent.category] ?? []) : [])
  ];
  const seen = new Set<string>();
  return aliases.filter((title) => {
    const normalized = normalizeTitle(title);
    if (
      !normalized
      || seen.has(normalized)
      || (
        intent.leadershipConstraint !== "UNSPECIFIED"
        && inferRoleLeadership(normalized) !== intent.leadershipConstraint
      )
    ) return false;
    seen.add(normalized);
    return true;
  });
}

export function buildDeterministicProviderTitlePlan(input: {
  intents: readonly RoleIntent[];
  maxPerRole: number;
  maxTotal: number;
}): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (title: string) => {
    const normalized = normalizeTitle(title);
    if (!normalized || seen.has(normalized) || result.length >= input.maxTotal) return;
    seen.add(normalized);
    result.push(title.trim());
  };

  // Exact requested roles always come first.
  for (const intent of input.intents) add(intent.rawTitle);

  const queues = input.intents.map((intent) =>
    providerAliasesForIntent(intent)
      .filter((title) => normalizeTitle(title) !== intent.normalizedTitle)
      .slice(0, Math.max(0, input.maxPerRole - 1))
  );
  for (let index = 0; result.length < input.maxTotal; index += 1) {
    let hadCandidate = false;
    for (const queue of queues) {
      const title = queue[index];
      if (!title) continue;
      hadCandidate = true;
      add(title);
      if (result.length >= input.maxTotal) break;
    }
    if (!hadCandidate) break;
  }
  return result;
}
