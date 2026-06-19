import type { GraphQLContext } from "@/graphql/context";
import { forbiddenError, requireUser } from "@/graphql/errors";
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
    return prepareProspectExport(context.prisma, user.id, args.input);
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
