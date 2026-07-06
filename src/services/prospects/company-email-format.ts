import { type ConfidenceLevel, isEmailPattern } from "@/lib/prospect-enums";
import {
  isAllowedBusinessEmailDomain,
  EMAIL_FORMAT_DISCOVERY_STATUSES,
  type EmailDomainEvidence,
  type EmailPatternEvidence
} from "@/services/prospects/email-domain-service";
import { combinedEmailConfidence } from "@/services/prospects/prospect-email-confidence";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

export type CompanyEmailFormatAuthority = "MANUAL" | "SOURCE" | "AI" | "SHARED_CACHE";

export type CompanyEmailFormatRecord = {
  emailDomain: string | null;
  emailDomainConfidence: string;
  emailDomainEvidence: unknown;
  emailPattern: string | null;
  patternConfidence: string;
  patternEvidence: unknown;
  emailFormatReason: string | null;
  emailFormatAuthority?: string | null;
  emailFormatDiscoveredAt?: Date | null;
  emailFormatDiscoveryStatus?: string | null;
  emailFormatDiscoveryReason?: string | null;
  emailFormatDiscoveryAt?: Date | string | null;
};

const AUTHORITY_RANK: Record<CompanyEmailFormatAuthority, number> = {
  SHARED_CACHE: 1,
  AI: 2,
  SOURCE: 3,
  MANUAL: 4
};

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  UNAVAILABLE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3
};

const TRUSTED_SOURCE_TYPES = new Set(["verified_email_sample", "public_format_page", "hunter"]);

function evidenceRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function hasEvidenceSource(format: CompanyEmailFormatRecord, predicate: (sourceType: string) => boolean): boolean {
  return [...evidenceRows(format.emailDomainEvidence), ...evidenceRows(format.patternEvidence)].some((row) =>
    typeof row.sourceType === "string" ? predicate(row.sourceType) : false
  );
}

export function inferCompanyEmailFormatAuthority(format: CompanyEmailFormatRecord): CompanyEmailFormatAuthority {
  if (
    format.emailFormatAuthority === "MANUAL" ||
    format.emailFormatAuthority === "SOURCE" ||
    format.emailFormatAuthority === "AI" ||
    format.emailFormatAuthority === "SHARED_CACHE"
  ) {
    return format.emailFormatAuthority;
  }
  if (
    hasEvidenceSource(format, (sourceType) => sourceType === "manual_override") ||
    /manual override|manual correction/i.test(format.emailFormatReason ?? "")
  ) {
    return "MANUAL";
  }
  if (hasEvidenceSource(format, (sourceType) => TRUSTED_SOURCE_TYPES.has(sourceType))) {
    return "SOURCE";
  }
  return "AI";
}

export function hasUsableCompanyEmailFormat(format: CompanyEmailFormatRecord): boolean {
  const domain = normalizeDomain(format.emailDomain);
  return Boolean(
    domain &&
      isAllowedBusinessEmailDomain(domain) &&
      isEmailPattern(format.emailPattern) &&
      combinedEmailConfidence(format.emailDomainConfidence, format.patternConfidence) !== "UNAVAILABLE"
  );
}

function confidenceRank(format: CompanyEmailFormatRecord): number {
  return CONFIDENCE_RANK[combinedEmailConfidence(format.emailDomainConfidence, format.patternConfidence)];
}

/**
 * Resolve one canonical company-format update without last-write-wins. Manual
 * corrections outrank parsed sources, parsed sources outrank AI, and a
 * role-specific shared-cache snapshot may only seed an empty company. Null or
 * lower-confidence candidates can never destroy a stronger usable format.
 */
export function resolveCompanyEmailFormatUpdate(
  current: CompanyEmailFormatRecord,
  candidate: CompanyEmailFormatRecord,
  candidateAuthority: CompanyEmailFormatAuthority = inferCompanyEmailFormatAuthority(candidate)
): CompanyEmailFormatRecord {
  const currentUsable = hasUsableCompanyEmailFormat(current);
  const candidateUsable = hasUsableCompanyEmailFormat(candidate);

  if (!candidateUsable) {
    if (!currentUsable) {
      return candidate;
    }
    const hasTypedOutcome = Boolean(
      candidate.emailFormatDiscoveryStatus ||
        candidate.emailFormatDiscoveryReason ||
        candidate.emailFormatDiscoveryAt
    );
    return hasTypedOutcome
      ? {
          ...current,
          emailFormatDiscoveryStatus: candidate.emailFormatDiscoveryStatus ?? current.emailFormatDiscoveryStatus,
          emailFormatDiscoveryReason: candidate.emailFormatDiscoveryReason ?? null,
          emailFormatDiscoveryAt: candidate.emailFormatDiscoveryAt ?? current.emailFormatDiscoveryAt
        }
      : current;
  }
  if (!currentUsable) {
    return candidate;
  }

  // Shared cache entries are query/role snapshots. Once the canonical company
  // owns a valid format, a cached child search is never authoritative over it.
  if (candidateAuthority === "SHARED_CACHE") {
    return current;
  }

  const currentAuthority = inferCompanyEmailFormatAuthority(current);
  const currentAuthorityRank = AUTHORITY_RANK[currentAuthority];
  const candidateAuthorityRank = AUTHORITY_RANK[candidateAuthority];
  if (candidateAuthorityRank < currentAuthorityRank) {
    return current;
  }
  if (candidateAuthorityRank > currentAuthorityRank) {
    return candidate;
  }

  return confidenceRank(candidate) < confidenceRank(current) ? current : candidate;
}

export function companyEmailFormatData(format: CompanyEmailFormatRecord) {
  return {
    emailDomain: normalizeDomain(format.emailDomain),
    emailDomainConfidence: format.emailDomainConfidence,
    emailDomainEvidence: (format.emailDomainEvidence ?? null) as EmailDomainEvidence[] | null,
    emailPattern: isEmailPattern(format.emailPattern) ? format.emailPattern : null,
    patternConfidence: format.patternConfidence,
    patternEvidence: (format.patternEvidence ?? null) as EmailPatternEvidence[] | null,
    emailFormatReason: format.emailFormatReason,
    emailFormatAuthority: inferCompanyEmailFormatAuthority(format),
    emailFormatDiscoveredAt: format.emailFormatDiscoveredAt ?? null,
    emailFormatDiscoveryStatus:
      format.emailFormatDiscoveryStatus === "NOT_ATTEMPTED" ||
      (EMAIL_FORMAT_DISCOVERY_STATUSES as readonly string[]).includes(format.emailFormatDiscoveryStatus ?? "")
        ? format.emailFormatDiscoveryStatus
        : hasUsableCompanyEmailFormat(format)
          ? "FOUND"
          : "NOT_ATTEMPTED",
    emailFormatDiscoveryReason: format.emailFormatDiscoveryReason ?? null,
    emailFormatDiscoveryAt: format.emailFormatDiscoveryAt ? new Date(format.emailFormatDiscoveryAt) : null
  };
}
