import type { ProspectCompany, ProspectCompanyPosition } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { coerceConfidenceLevel, overlayEmailCandidateStatus } from "@/lib/prospect-enums";
import { env } from "@/lib/env";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { asStringArray, mapProspectError } from "@/graphql/resolvers/helpers";
import { notFoundError, requireUser } from "@/graphql/errors";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";
import { EMAIL_FORMAT_DISCOVERY_STATUSES } from "@/services/prospects/email-domain-service";

type EvidenceRow = {
  emailDomain?: unknown;
  pattern?: unknown;
  observedPattern?: unknown;
  reason?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  sourceType?: unknown;
  percentage?: unknown;
  confidence?: unknown;
  observedAt?: unknown;
};

export const companyQueries = {
  async company(_root: unknown, args: { id: string }, context: GraphQLContext) {
    requireUser(context);
    // The loader is user-scoped, so a company owned by another user resolves to
    // null (no cross-user access).
    return context.loaders.companyById.load(args.id);
  },

  async companies(_root: unknown, args: { first?: number | null; after?: string | null }, context: GraphQLContext) {
    const user = requireUser(context);
    const first = resolveFirst(args.first, 20);
    const afterId = decodeCursor(args.after);

    const [rows, totalCount] = await Promise.all([
      context.prisma.prospectCompany.findMany({ where: { userId: user.id }, ...cursorArgs(first, afterId) }),
      context.prisma.prospectCompany.count({ where: { userId: user.id } })
    ]);

    return buildConnection(rows, first, totalCount);
  }
};

export const companyMutations = {
  async reclassifyCompanyPositions(_root: unknown, args: { companyId: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.reclassifyCompanyPositions(user.id, args.companyId);
    } catch (error) {
      mapProspectError(error);
    }
  },

  async reinferCompanyEmailPattern(_root: unknown, args: { companyId: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.reinferCompanyEmailPattern(user.id, args.companyId);
    } catch (error) {
      mapProspectError(error);
    }
  },

  async refreshCompanyEmailFormat(
    _root: unknown,
    args: { companyId: string; sourceUrl?: string | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.refreshCompanyEmailFormat(user.id, args.companyId, args.sourceUrl ?? null);
    } catch (error) {
      mapProspectError(error);
    }
  },

  async discoverCompanyEmailFormat(
    _root: unknown,
    args: { companyId: string; force?: boolean | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.discoverCompanyEmailFormat(user.id, args.companyId, {
        force: Boolean(args.force)
      });
    } catch (error) {
      mapProspectError(error);
    }
  },

  async deleteCompany(_root: unknown, args: { companyId: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.deleteCompany(user.id, args.companyId);
    } catch (error) {
      mapProspectError(error);
    }
  },

  async setCompanyEmailInferenceOverride(
    _root: unknown,
    args: {
      companyId: string;
      emailDomain: string;
      emailPattern: string;
      confidence: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";
      reason?: string | null;
    },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.setCompanyEmailInferenceOverride(user.id, args);
    } catch (error) {
      mapProspectError(error);
    }
  }
};

export const Company = {
  positions(parent: ProspectCompany, _args: unknown, context: GraphQLContext) {
    return context.loaders.positionsByCompanyId.load(parent.id);
  },
  /**
   * The authenticated user's OWN searches for this company, newest first. The
   * userId filter comes from the session (never the client), so one user's
   * grouped detail can never enumerate another user's searches.
   */
  async searches(parent: ProspectCompany, _args: unknown, context: GraphQLContext) {
    const user = requireUser(context);
    const rows = await context.prisma.prospectSearch.findMany({
      where: { companyId: parent.id, userId: user.id }
    });
    return rows.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || (a.id < b.id ? 1 : -1)
    );
  },
  peopleCount(parent: ProspectCompany, _args: unknown, context: GraphQLContext) {
    return context.loaders.peopleCountByCompanyId.load(parent.id);
  },
  async emailStatusCounts(parent: ProspectCompany, _args: unknown, context: GraphQLContext) {
    const rows = await context.loaders.emailStatusRowsByCompanyId.load(parent.id);
    // Overlay the user's live suppression state (failed / unsubscribed /
    // blocked) before aggregating, using the same precedence as the per-person
    // resolver — the summary and the table always agree. Unknown stored
    // statuses coerce to UNAVAILABLE so the enum contract holds for legacy rows.
    const storedReasons = await Promise.all(
      rows.map((row) =>
        row.inferredEmail
          ? context.loaders.suppressionReasonByEmail.load(row.inferredEmail.trim().toLowerCase())
          : Promise.resolve(null)
      )
    );
    const derivedRows = rows.map((row, index) =>
      resolveProspectPersonEmail(row, parent, {
        allowLowConfidence: env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS,
        suppressed: Boolean(storedReasons[index])
      })
    );
    const derivedReasons = await Promise.all(
      derivedRows.map((row) =>
        row.inferredEmail
          ? context.loaders.suppressionReasonByEmail.load(row.inferredEmail.trim().toLowerCase())
          : Promise.resolve(null)
      )
    );
    const counts = new Map<string, number>();
    derivedRows.forEach((row, index) => {
      const status = overlayEmailCandidateStatus(row.emailStatus, derivedReasons[index]);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    });
    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  },
  domainConfidence(parent: ProspectCompany) {
    return coerceConfidenceLevel(parent.domainConfidence);
  },
  officialWebsiteDomain(parent: ProspectCompany) {
    return parent.officialWebsiteDomain ?? parent.officialDomain ?? null;
  },
  emailDomainConfidence(parent: ProspectCompany) {
    return coerceConfidenceLevel(parent.emailDomainConfidence);
  },
  emailFormatDiscoveryStatus(parent: ProspectCompany) {
    return (EMAIL_FORMAT_DISCOVERY_STATUSES as readonly string[]).includes(parent.emailFormatDiscoveryStatus)
      ? parent.emailFormatDiscoveryStatus
      : "NOT_ATTEMPTED";
  },
  emailDomainEvidence(parent: ProspectCompany) {
    const evidence = Array.isArray(parent.emailDomainEvidence) ? (parent.emailDomainEvidence as EvidenceRow[]) : [];
    return evidence
      .filter((row) => typeof row?.emailDomain === "string")
      .map((row) => ({
        emailDomain: String(row.emailDomain),
        sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : null,
        sourceName: typeof row.sourceName === "string" ? row.sourceName : "inference",
        sourceType: typeof row.sourceType === "string" ? row.sourceType : "search_snippet",
        observedPattern: typeof row.observedPattern === "string" ? row.observedPattern : null,
        percentage: typeof row.percentage === "number" ? row.percentage : null,
        confidence: coerceConfidenceLevel(row.confidence),
        observedAt: typeof row.observedAt === "string" ? row.observedAt : null
      }));
  },
  emailPattern(parent: ProspectCompany) {
    return parent.emailDomain ? parent.emailPattern : null;
  },
  patternConfidence(parent: ProspectCompany) {
    if (!parent.emailDomain) {
      return "UNAVAILABLE";
    }
    return coerceConfidenceLevel(parent.patternConfidence);
  },
  patternEvidence(parent: ProspectCompany) {
    if (!parent.emailDomain) {
      return [];
    }
    const evidence = Array.isArray(parent.patternEvidence) ? (parent.patternEvidence as EvidenceRow[]) : [];
    return evidence
      .filter((row) => typeof row?.pattern === "string")
      .map((row) => ({
        pattern: String(row.pattern),
        emailDomain: typeof row.emailDomain === "string" ? row.emailDomain : null,
        sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : null,
        sourceType: typeof row.sourceType === "string" ? row.sourceType : "search_snippet",
        sourceName: typeof row.sourceName === "string" ? row.sourceName : typeof row.reason === "string" ? row.reason : "inference",
        percentage: typeof row.percentage === "number" ? row.percentage : null,
        confidence: coerceConfidenceLevel(row.confidence ?? parent.patternConfidence),
        observedAt: typeof row.observedAt === "string" ? row.observedAt : null
      }));
  }
};

export const CompanyPosition = {
  async company(parent: ProspectCompanyPosition, _args: unknown, context: GraphQLContext) {
    const company = await context.loaders.companyById.load(parent.companyId);
    if (!company) {
      throw notFoundError("Company not found.");
    }
    return company;
  },
  rawTitles(parent: ProspectCompanyPosition) {
    return asStringArray(parent.rawTitles);
  },
  async people(parent: ProspectCompanyPosition, _args: unknown, context: GraphQLContext) {
    const [company, people] = await Promise.all([
      context.loaders.companyById.load(parent.companyId),
      context.loaders.peopleByPositionId.load(parent.id)
    ]);
    if (!company) {
      throw notFoundError("Company not found.");
    }
    return Promise.all(
      people.map(async (person) => {
        const reason = person.inferredEmail
          ? await context.loaders.suppressionReasonByEmail.load(person.inferredEmail.trim().toLowerCase())
          : null;
        return {
          ...person,
          ...resolveProspectPersonEmail(person, company, {
            allowLowConfidence: env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS,
            suppressed: Boolean(reason)
          })
        };
      })
    );
  },
  peopleCount(parent: ProspectCompanyPosition, _args: unknown, context: GraphQLContext) {
    return context.loaders.peopleCountByPositionId.load(parent.id);
  }
};
