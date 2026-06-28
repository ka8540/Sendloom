import type { GraphQLContext } from "@/graphql/context";
import { forbiddenError, requireUser } from "@/graphql/errors";
import { recordAuditEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  createProspectImport,
  prepareProspectExport,
  resolveProspectSelection,
  type ProspectSelectionInput
} from "@/services/prospects/prospect-export";

async function enforceProspectActionLimit(userId: string, action: "export" | "import") {
  const limit = await rateLimit({
    key: `prospects:${action}:user:${userId}`,
    limit: 10,
    windowSeconds: 60 * 60
  });

  if (!limit.allowed) {
    throw forbiddenError("Too many prospect actions. Please try again later.");
  }
}

export const prospectExportMutations = {
  async reviewProspectSelection(
    _root: unknown,
    args: { input: ProspectSelectionInput },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    const result = await resolveProspectSelection(context.prisma, user.id, args.input);
    return result.review;
  },

  async prepareProspectExport(
    _root: unknown,
    args: { input: ProspectSelectionInput },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    await enforceProspectActionLimit(user.id, "export");
    const result = await prepareProspectExport(context.prisma, user.id, args.input);

    // Best-effort activity event for the Overview feed. recordAuditEvent never
    // throws for non-critical events, so a logging failure cannot break the
    // export. Only safe counters/labels are recorded — no emails, file names,
    // or download URLs.
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "discover.results_exported",
      category: "SYSTEM",
      target: { type: "ProspectExport", id: args.input.companyId, name: result.companyName },
      message: `Exported ${result.review.selectedCount} selected Discover contacts.`,
      metadata: { company: result.companyName, selectedCount: result.review.selectedCount }
    });

    return result;
  },

  async createProspectImport(
    _root: unknown,
    args: { input: ProspectSelectionInput },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    await enforceProspectActionLimit(user.id, "import");
    return createProspectImport(context.prisma, user.id, args.input);
  }
};
