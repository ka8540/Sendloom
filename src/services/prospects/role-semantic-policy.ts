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
export type RoleMatchKind = "EXACT" | "ALIAS" | "POLICY" | "VECTOR";

export type RoleIntent = {
  rawTitle: string;
  normalizedTitle: string;
  canonicalRoleKey: string;
  category: PositionCategory;
  specialty: RoleSpecialty;
  breadth: RoleBreadth;
  classificationConfidence: ConfidenceLevel;
};

export type RoleMatchDecision = {
  kind: RoleMatchKind;
  score: number;
};

export const ROLE_VECTOR_THRESHOLDS = {
  broadCache: 0.76,
  narrowCache: 0.84,
  provider: 0.9
} as const;

const MANAGEMENT_PATTERN =
  /\b(manager|management|director|head|vice president|vp|chief|cto|cio|ceo|cfo|coo|cmo|cpo)\b/;

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
  "recruiting:general": ["Recruiter", "Talent Acquisition Specialist"]
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
  if (specialty === "MANAGEMENT") return `management:${normalizedTitle}`;
  return `software:${normalizedTitle}`;
}

export function inferRoleSpecialty(normalizedTitle: string, category: PositionCategory): RoleSpecialty {
  if (MANAGEMENT_PATTERN.test(normalizedTitle)) return "MANAGEMENT";
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

function canonicalRoleKey(normalizedTitle: string, category: PositionCategory, specialty: RoleSpecialty): string {
  if (category === "SOFTWARE_ENGINEERING") {
    return canonicalSoftwareKey(normalizedTitle, specialty);
  }
  if (category === "MANAGEMENT" && /\b(cto|chief technology officer)\b/.test(normalizedTitle)) {
    return "management:cto";
  }
  if (category === "RECRUITING") {
    return "recruiting:general";
  }
  return `${category.toLowerCase()}:${normalizedTitle}`;
}

export function deriveRoleIntent(input: {
  rawTitle: string;
  category: PositionCategory;
  confidence?: ConfidenceLevel;
}): RoleIntent | null {
  const normalizedTitle = normalizeTitle(input.rawTitle);
  if (!normalizedTitle) return null;
  const specialty = inferRoleSpecialty(normalizedTitle, input.category);
  const breadth: RoleBreadth =
    (input.category === "SOFTWARE_ENGINEERING" && specialty === "GENERAL") ||
    input.category === "RECRUITING" ||
    input.category === "HUMAN_RESOURCES"
      ? "BROAD"
      : "NARROW";
  return {
    rawTitle: input.rawTitle.trim(),
    normalizedTitle,
    canonicalRoleKey: canonicalRoleKey(normalizedTitle, input.category, specialty),
    category: input.category,
    specialty,
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

function specialtiesCompatible(query: RoleIntent, candidate: RoleIntent, context: RoleMatchContext): boolean {
  if (query.specialty === "MANAGEMENT" || candidate.specialty === "MANAGEMENT") {
    return query.canonicalRoleKey === candidate.canonicalRoleKey;
  }
  if (query.category !== "SOFTWARE_ENGINEERING") {
    return query.category !== "OTHER";
  }
  if (query.specialty === "GENERAL" && query.breadth === "BROAD") {
    const allowed = context === "PROVIDER" ? PROVIDER_SOFTWARE_SPECIALTIES : BROAD_SOFTWARE_SPECIALTIES;
    return allowed.has(candidate.specialty);
  }
  return query.specialty === candidate.specialty;
}

/**
 * Hybrid authorization + ranking decision. Category and specialty guards run
 * before similarity; vectors can rank an allowed relationship but can never
 * turn an incompatible role into a match.
 */
export function decideRoleMatch(input: {
  query: RoleIntent;
  candidate: RoleIntent;
  context: RoleMatchContext;
  vectorSimilarity?: number | null;
}): RoleMatchDecision | null {
  const { query, candidate, context } = input;
  if (query.normalizedTitle === candidate.normalizedTitle) {
    return { kind: "EXACT", score: 1_000 };
  }
  if (query.category !== candidate.category) return null;
  if (query.category === "OTHER") return null;
  if (query.canonicalRoleKey === candidate.canonicalRoleKey) {
    return { kind: "ALIAS", score: 900 + tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 10 };
  }
  if (!specialtiesCompatible(query, candidate, context)) return null;

  // A broad Software Engineer request intentionally authorizes this small,
  // deterministic family of provider specialties. These candidates already
  // passed the employer, location, category, and management guards above, so a
  // missing/stale vector row (or a score below the ranking threshold) must not
  // turn an otherwise valid paid provider result into data loss. Vectors still
  // rank less explicit relationships; they are not an authorization requirement
  // for this audited Software Engineer family.
  if (
    context === "PROVIDER" &&
    query.category === "SOFTWARE_ENGINEERING" &&
    query.specialty === "GENERAL" &&
    query.breadth === "BROAD" &&
    PROVIDER_SOFTWARE_SPECIALTIES.has(candidate.specialty)
  ) {
    return { kind: "POLICY", score: 850 + tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 20 };
  }

  const similarity = input.vectorSimilarity;
  if (typeof similarity === "number" && Number.isFinite(similarity)) {
    const threshold =
      context === "PROVIDER"
        ? ROLE_VECTOR_THRESHOLDS.provider
        : query.breadth === "BROAD"
          ? ROLE_VECTOR_THRESHOLDS.broadCache
          : ROLE_VECTOR_THRESHOLDS.narrowCache;
    if (similarity < threshold) return null;
    return {
      kind: "VECTOR",
      score: 700 + similarity * 100 + tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 20
    };
  }

  // The broader cache path keeps its deterministic compatibility fallback.
  // Provider-only deterministic authorization is handled by the narrower
  // audited Software Engineer family above.
  if (context === "CACHE") {
    return { kind: "POLICY", score: 500 + tokenSimilarity(query.normalizedTitle, candidate.normalizedTitle) * 20 };
  }
  return null;
}

export function providerAliasesForIntent(intent: RoleIntent): readonly string[] {
  return PROVIDER_EXPANSIONS[intent.canonicalRoleKey] ?? [];
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
